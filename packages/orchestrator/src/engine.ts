import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import {
  appendRuntimeEvent,
  assertPolicy,
  getTask,
  updateTaskStatus,
  createAgentRun,
  getAgent,
  type MesaActor,
  type MesaRuntimeContext,
  type MesaWorkspacePaths,
} from '@agentmesa/core';
import { canTransitionTaskStatus, type RunAction, type WorkflowDecisionCommand } from '@agentmesa/protocol';
import {
  executeRun,
  resolveDriverRegistryFromEnv,
  attachPermissionResponder,
} from '@agentmesa/runner';
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
          state.status = 'waiting_approval';
          this.saveState(state);
          this.appendWorkflowEvent(state, 'workflow_waiting_approval', {
            stepId: step.id,
            description: step.description,
          });
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

  /** Actor identity for a run's gated (deep-driver) actions: the run's agent and its roles; falls back to the engine context actor. */
  private runAgentActor(agentId: string): MesaActor {
    try {
      const agent = getAgent(this.ctx, agentId);
      return { id: agentId, type: 'agent', roles: agent.roles, client: agent.client };
    } catch {
      return this.ctx.actor;
    }
  }

  private async runAgentStep(
    state: WorkflowState,
    step: WorkflowStep,
    exec: StepExecution,
  ): Promise<void> {
    const action = (step.runnerType ?? 'implement') as RunAction;
    const run = createAgentRun(this.ctx, {
      agentId: step.agentId ?? 'agent',
      input: this.buildAgentInput(state, step.description),
      taskId: state.taskId,
      action,
    });

    let succeeded: boolean;
    try {
      const { run: final } = await executeRun(this.ctx, run.id, attachPermissionResponder({
        // Deep drivers are enabled via the AGENTMESA_DRIVER env switch
        // (unset/auto → registry with CLI fallback; cli → empty registry).
        // Workflow definitions gain no new fields — the env is the only source.
        driverRegistry: resolveDriverRegistryFromEnv(),
      }, {
        ctx: this.ctx,
        // Gated actions are judged under the run's agent identity.
        actor: this.runAgentActor(run.agentId),
      }));
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
      if (step.runnerType === 'review') {
        this.syncReviewVerdict(state);
      }
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

  /**
   * A reviewer run_agent step drives an AI CLI session that, when MCP is
   * configured, calls `mesa_submit_review` directly during that session —
   * which lands the real verdict on the task's status (see
   * `handleSubmitReview` in @agentmesa/mcp-server). Read it back into the
   * workflow context so the next `check` step evaluates the real verdict
   * instead of a value only a human `approve()` call could ever set.
   */
  private syncReviewVerdict(state: WorkflowState): void {
    const task = getTask(this.ctx, state.taskId);
    if (task.status === 'approved') {
      state.context.approved = true;
      state.context.changesRequested = false;
    } else if (task.status === 'changes_requested') {
      state.context.approved = false;
      state.context.changesRequested = true;
    }
    // Any other status (e.g. still 'reviewing') means no MCP verdict landed
    // during this run — leave context untouched, same as the stub/CI
    // fallback behavior when no real runner backend is configured.
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

  approve(state: WorkflowState, message?: string, commandId?: string): WorkflowState {
    if (state.status !== 'waiting_approval') {
      throw new Error(`Cannot approve: workflow is ${state.status}`);
    }

    const def = getWorkflowDefinition(state.workflowDefinitionId);
    const step = def.steps.find((s) => s.id === state.currentStep);
    if (!step || step.type !== 'human_approval') {
      throw new Error(`Cannot approve: current step is not a human_approval step`);
    }

    const execution = state.history.at(-1);
    if (!execution || execution.stepId !== step.id || execution.status !== 'running') {
      throw new Error(`Cannot approve: approval execution is not active`);
    }
    execution.status = 'completed';
    execution.completedAt = new Date().toISOString();
    state.context.approved = true;
    this.setApprovalMessage(state, step.id, step.onSuccess, message);
    state.status = 'running';
    this.advanceToStep(state, step.onSuccess);
    this.appendWorkflowEvent(state, 'workflow_approved', { message, commandId });
    return state;
  }

  reject(state: WorkflowState, reason: string, message?: string, commandId?: string): WorkflowState {
    if (state.status !== 'waiting_approval') {
      throw new Error(`Cannot reject: workflow is ${state.status}`);
    }
    const execution = state.history.at(-1);
    if (!execution || execution.stepId !== state.currentStep || execution.status !== 'running') {
      throw new Error(`Cannot reject: approval execution is not active`);
    }
    execution.status = 'failed';
    execution.error = reason;
    execution.completedAt = new Date().toISOString();
    state.status = 'failed';
    state.completedAt = execution.completedAt;
    state.context.metadata = {
      ...state.context.metadata,
      ...(message === undefined ? {} : { rejectionMessage: message }),
    };
    this.saveState(state);
    this.appendWorkflowEvent(state, 'workflow_rejected', { reason, message, commandId });
    return state;
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

  private buildAgentInput(state: WorkflowState, description: string): string {
    const approval = state.context.metadata?.['approvalContext'];
    if (
      typeof approval !== 'object' ||
      approval === null ||
      !('targetStepId' in approval) ||
      approval.targetStepId !== state.currentStep ||
      !('message' in approval) ||
      typeof approval.message !== 'string'
    ) {
      delete state.context.metadata?.['approvalContext'];
      return description;
    }
    delete state.context.metadata!['approvalContext'];
    return `${description}\n\nUser approval context:\n${approval.message}`;
  }

  private setApprovalMessage(
    state: WorkflowState,
    approvalStepId: string,
    targetStepId: string,
    message?: string,
  ): void {
    if (message === undefined) {
      delete state.context.metadata?.['approvalContext'];
      return;
    }
    state.context.metadata = {
      ...state.context.metadata,
      approvalContext: { approvalStepId, targetStepId, message },
    };
  }

  private appendWorkflowEvent(
    state: WorkflowState,
    type: 'workflow_waiting_approval' | 'workflow_approved' | 'workflow_rejected',
    data: Record<string, unknown>,
  ): void {
    appendRuntimeEvent(this.ctx, {
      meetingId: state.taskId,
      type,
      streamId: state.workflowId,
      streamType: 'workflow',
      data: {
        workflowId: state.workflowId,
        taskId: state.taskId,
        status: state.status,
        ...data,
      },
    });
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

/**
 * List all persisted workflow states across every workflow, newest first.
 * Reads the same `paths.logsDir/workflows/` directory that
 * `WorkflowEngine.saveState`/`loadState` use, independent of any single
 * engine instance's in-memory cache.
 */
export type WorkflowDecisionInput = Omit<WorkflowDecisionCommand, 'commandId'> & {
  commandId?: string;
};

export function decideWorkflow(
  ctx: MesaRuntimeContext,
  workflowId: string,
  input: WorkflowDecisionInput,
): WorkflowState {
  assertPolicy(ctx, 'workflow.decide', `workflow:${workflowId}`);
  const engine = new WorkflowEngine(ctx);
  const state = engine.getState(workflowId);
  if (!state) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  if (input.commandId) {
    const existing = ctx.eventStore.list({ streamId: workflowId }).find((event) =>
      (event.type === 'workflow_approved' || event.type === 'workflow_rejected') &&
      event.data['commandId'] === input.commandId,
    );
    if (existing) {
      return state;
    }
    if (state.status !== 'waiting_approval') {
      const type = input.decision === 'approve' ? 'workflow_approved' : 'workflow_rejected';
      appendRuntimeEvent(ctx, {
        meetingId: state.taskId,
        type,
        streamId: state.workflowId,
        streamType: 'workflow',
        data: {
          workflowId: state.workflowId,
          taskId: state.taskId,
          status: state.status,
          commandId: input.commandId,
          recovered: true,
        },
      });
      return state;
    }
  }
  if (input.decision === 'approve') {
    return engine.approve(state, input.message, input.commandId);
  }
  return engine.reject(
    state,
    input.reason ?? 'Rejected by user',
    input.message,
    input.commandId,
  );
}

export function listWorkflowStates(ctx: MesaRuntimeContext): WorkflowState[] {
  const dir = join(ctx.paths.logsDir, 'workflows');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as WorkflowState)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
