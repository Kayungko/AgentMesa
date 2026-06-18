import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  getTask,
  updateTaskStatus,
  createAgentRun,
  type MesaRuntimeContext,
  type MesaWorkspacePaths,
} from '@agentmesa/core';
import { canTransitionTaskStatus, type RunAction } from '@agentmesa/protocol';
import { executeRun } from '@agentmesa/runner';
import type {
  WorkflowDefinition,
  WorkflowState,
  WorkflowStep,
  StepExecution,
  WorkflowContext,
} from './types.js';
import { getWorkflowDefinition } from './registry.js';

const DEFAULT_MAX_STEPS = 50;

export class WorkflowEngine {
  private readonly ctx: MesaRuntimeContext;
  private readonly paths: MesaWorkspacePaths;
  private readonly stateCache: Map<string, WorkflowState> = new Map();

  constructor(ctx: MesaRuntimeContext) {
    this.ctx = ctx;
    this.paths = ctx.paths;
  }

  startWorkflow(definition: WorkflowDefinition, taskId: string): WorkflowState {
    const workflowId = randomUUID();
    const now = new Date().toISOString();

    const context: WorkflowContext = {
      taskId,
      workflowId,
      reviewCycles: 0,
      approved: false,
      changesRequested: false,
    };

    const state: WorkflowState = {
      workflowId,
      workflowDefinitionId: definition.id,
      currentStep: definition.startStep,
      status: 'running',
      taskId,
      history: [],
      startedAt: now,
      context,
    };

    this.stateCache.set(workflowId, state);
    this.saveState(state);

    return state;
  }

  async executeStep(state: WorkflowState): Promise<WorkflowState> {
    if (state.status !== 'running') {
      throw new Error(`Cannot execute step: workflow is ${state.status}`);
    }

    if (state.currentStep === '__end__') {
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      this.saveState(state);
      return state;
    }

    const def = getWorkflowDefinition(state.workflowDefinitionId);
    const step = def.steps.find((s) => s.id === state.currentStep);

    if (!step) {
      return this.abort(state, `Unknown step: ${state.currentStep}`);
    }

    const stepExecution: StepExecution = {
      stepId: step.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    state.history.push(stepExecution);

    try {
      switch (step.type) {
        case 'update_status':
          this.runUpdateStatus(state, step, stepExecution);
          break;
        case 'run_agent':
          await this.runAgentStep(state, step, stepExecution);
          break;
        case 'check':
          this.runCheck(state, step, stepExecution);
          break;
        case 'human_approval':
          stepExecution.status = 'completed';
          stepExecution.completedAt = new Date().toISOString();
          state.status = 'waiting_approval';
          this.saveState(state);
          return state;
        case 'wait':
          this.completeStep(stepExecution, step.onSuccess, state);
          break;
        default:
          return this.failStep(state, stepExecution, `Unknown step type: ${String(step.type)}`);
      }

      // For run_agent the next step is set inside the handler (success/failure
      // branch). For other step types the handler set the next step already.
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failStep(state, stepExecution, message);
    }
  }

  private runUpdateStatus(
    state: WorkflowState,
    step: WorkflowStep,
    exec: StepExecution,
  ): void {
    const target = step.statusUpdate;
    if (target) {
      const task = getTask(this.ctx, state.taskId);
      if (task.status === target) {
        exec.result = { skipped: 'already-in-target-status', status: target };
      } else if (canTransitionTaskStatus(task.status, target)) {
        updateTaskStatus(this.ctx, state.taskId, target);
        exec.result = { status: target };
      } else {
        // Tolerant: an invalid transition (e.g. loop re-entry) must not fail
        // the workflow — record and continue.
        exec.result = { skipped: 'invalid-transition', from: task.status, to: target };
      }
    }
    this.completeStep(exec, step.onSuccess, state);
  }

  private async runAgentStep(
    state: WorkflowState,
    step: WorkflowStep,
    exec: StepExecution,
  ): Promise<void> {
    const action = (step.runnerType ?? 'implement') as RunAction;
    const run = createAgentRun(this.ctx, {
      agentId: step.agentId ?? 'agent',
      input: step.description,
      taskId: state.taskId,
      action,
    });

    let succeeded: boolean;
    try {
      const { run: final } = await executeRun(this.ctx, run.id, {});
      succeeded = final.status === 'completed';
      exec.result = { runId: final.id, status: final.status };
      if (!succeeded) {
        exec.error = final.error;
      }
    } catch (error) {
      succeeded = false;
      exec.result = { runId: run.id, status: 'failed' };
      exec.error = error instanceof Error ? error.message : String(error);
    }

    if (succeeded) {
      this.completeStep(exec, step.onSuccess, state);
      return;
    }

    const onFailure = step.onFailure ?? 'abort';
    if (onFailure === 'abort') {
      exec.status = 'failed';
      exec.completedAt = new Date().toISOString();
      this.abort(state, exec.error ?? `Step ${step.id} failed`);
      return;
    }
    // Routed failure: the step itself completed its dispatch; advance to the
    // failure branch.
    this.completeStep(exec, onFailure, state);
  }

  private runCheck(state: WorkflowState, step: WorkflowStep, exec: StepExecution): void {
    const passed = step.condition ? step.condition(state.context) : true;
    if (passed) {
      exec.result = { check: 'passed' };
      this.completeStep(exec, step.onSuccess, state);
    } else {
      state.context.reviewCycles = (state.context.reviewCycles ?? 0) + 1;
      exec.result = { check: 'failed', reviewCycles: state.context.reviewCycles };
      this.completeStep(exec, step.onFailure ?? step.onSuccess, state);
    }
  }

  private completeStep(exec: StepExecution, nextStepId: string, state: WorkflowState): void {
    exec.status = 'completed';
    exec.completedAt = new Date().toISOString();
    this.advanceToStep(state, nextStepId);
  }

  private failStep(
    state: WorkflowState,
    exec: StepExecution,
    message: string,
  ): WorkflowState {
    exec.status = 'failed';
    exec.error = message;
    exec.completedAt = new Date().toISOString();
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
    this.saveState(state);
    return state;
  }

  async advanceWorkflow(
    state: WorkflowState,
    opts?: { maxSteps?: number },
  ): Promise<WorkflowState> {
    const maxSteps = opts?.maxSteps ?? DEFAULT_MAX_STEPS;
    let steps = 0;

    while (state.status === 'running' && state.currentStep !== '__end__') {
      if (steps >= maxSteps) {
        return this.abort(state, `Exceeded max steps (${maxSteps})`);
      }
      await this.executeStep(state);
      steps += 1;
    }

    if (state.status === 'running' && state.currentStep === '__end__') {
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      this.saveState(state);
    }

    return state;
  }

  approve(state: WorkflowState): WorkflowState {
    if (state.status !== 'waiting_approval') {
      throw new Error(`Cannot approve: workflow is ${state.status}`);
    }

    const def = getWorkflowDefinition(state.workflowDefinitionId);
    const step = def.steps.find((s) => s.id === state.currentStep);
    if (!step || step.type !== 'human_approval') {
      throw new Error(`Cannot approve: current step is not a human_approval step`);
    }

    state.context.approved = true;
    state.status = 'running';
    this.advanceToStep(state, step.onSuccess);
    return state;
  }

  reject(state: WorkflowState, reason: string): WorkflowState {
    return this.abort(state, reason);
  }

  advanceToStep(state: WorkflowState, nextStepId: string): WorkflowState {
    state.currentStep = nextStepId;

    if (nextStepId === '__end__') {
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
    }

    this.saveState(state);
    return state;
  }

  pause(state: WorkflowState): WorkflowState {
    if (state.status !== 'running') {
      throw new Error(`Cannot pause: workflow is ${state.status}`);
    }

    state.status = 'paused';
    state.pausedAt = new Date().toISOString();
    this.saveState(state);

    return state;
  }

  resume(state: WorkflowState): WorkflowState {
    if (state.status !== 'paused') {
      throw new Error(`Cannot resume: workflow is ${state.status}`);
    }

    state.status = 'running';
    state.resumedAt = new Date().toISOString();
    this.saveState(state);

    return state;
  }

  abort(state: WorkflowState, reason: string): WorkflowState {
    state.status = 'failed';
    state.completedAt = new Date().toISOString();

    // Add abort reason to history
    const abortExecution: StepExecution = {
      stepId: state.currentStep,
      status: 'failed',
      error: reason,
      completedAt: new Date().toISOString(),
    };
    state.history.push(abortExecution);

    this.saveState(state);
    return state;
  }

  getState(workflowId: string): WorkflowState | null {
    return this.stateCache.get(workflowId) ?? this.loadState(workflowId);
  }

  saveState(state: WorkflowState): void {
    const workflowsDir = join(this.paths.logsDir, 'workflows');

    if (!existsSync(workflowsDir)) {
      mkdirSync(workflowsDir, { recursive: true });
    }

    const filePath = join(workflowsDir, `${state.workflowId}.json`);
    const content = JSON.stringify(state, null, 2);
    writeFileSync(filePath, content, 'utf-8');

    this.stateCache.set(state.workflowId, state);
  }

  loadState(workflowId: string): WorkflowState | null {
    const filePath = join(this.paths.logsDir, 'workflows', `${workflowId}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    const content = readFileSync(filePath, 'utf-8');
    const state = JSON.parse(content) as WorkflowState;

    this.stateCache.set(workflowId, state);
    return state;
  }
}
