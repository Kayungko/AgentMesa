import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type {
  WorkflowDefinition,
  WorkflowState,
  StepExecution,
  WorkflowContext,
} from './types.js';

export class WorkflowEngine {
  private readonly paths: MesaWorkspacePaths;
  private readonly stateCache: Map<string, WorkflowState> = new Map();

  constructor(paths: MesaWorkspacePaths) {
    this.paths = paths;
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

    const stepExecution: StepExecution = {
      stepId: state.currentStep,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    state.history.push(stepExecution);

    try {
      // Mark step as completed
      stepExecution.status = 'completed';
      stepExecution.completedAt = new Date().toISOString();

      // For now, we simulate successful execution
      // In a real implementation, this would invoke the appropriate runner
      // based on the step type and configuration

      // For check steps, we evaluate the condition
      // For human_approval steps, we set status to waiting_approval
      // For other steps, we advance to onSuccess

      // Simple state machine: advance to next step
      // This is a placeholder - real implementation would look up the step
      // from the workflow definition and execute accordingly

      this.saveState(state);
      return state;
    } catch (error) {
      stepExecution.status = 'failed';
      stepExecution.error = error instanceof Error ? error.message : String(error);
      stepExecution.completedAt = new Date().toISOString();

      state.status = 'failed';
      this.saveState(state);
      return state;
    }
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
