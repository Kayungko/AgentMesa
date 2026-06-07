import type { TaskStatus } from '@agentmesa/protocol';

// --- Step types ---

export type WorkflowStepType =
  | 'run_agent'
  | 'human_approval'
  | 'check'
  | 'update_status'
  | 'wait';

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  runnerType?: string;
  agentId?: string;
  description: string;
  condition?: (context: WorkflowContext) => boolean;
  onSuccess: string;
  onFailure?: string | 'abort';
  timeout?: number;
  statusUpdate?: TaskStatus;
}

// --- Workflow context ---

export interface WorkflowContext {
  taskId: string;
  workflowId: string;
  reviewCycles?: number;
  approved?: boolean;
  changesRequested?: boolean;
  metadata?: Record<string, unknown>;
}

// --- Workflow definition ---

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  startStep: string;
}

// --- Workflow state ---

export type WorkflowStateStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'waiting_approval';

export interface StepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowState {
  workflowId: string;
  workflowDefinitionId: string;
  currentStep: string;
  status: WorkflowStateStatus;
  taskId: string;
  history: StepExecution[];
  pausedAt?: string;
  resumedAt?: string;
  startedAt: string;
  completedAt?: string;
  context: WorkflowContext;
}
