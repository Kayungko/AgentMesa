export const taskStatuses = [
  'backlog',
  'ready',
  'todo',
  'in_progress',
  'ready_for_review',
  'reviewing',
  'in_review',
  'changes_requested',
  'needs_fix',
  'approved',
  'completed',
  'done',
  'blocked',
  'failed',
  'cancelled',
  'conflict',
  'needs_user_decision',
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

const terminalStatuses: readonly TaskStatus[] = ['completed', 'done', 'cancelled'];

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['ready', 'todo', 'cancelled'],
  ready: ['in_progress', 'backlog', 'cancelled'],
  todo: ['in_progress', 'cancelled'],
  in_progress: ['ready_for_review', 'in_review', 'blocked', 'failed', 'cancelled', 'needs_fix'],
  ready_for_review: ['reviewing', 'changes_requested', 'cancelled'],
  reviewing: ['approved', 'changes_requested', 'blocked', 'failed'],
  in_review: ['approved', 'changes_requested', 'needs_fix', 'blocked', 'failed'],
  changes_requested: ['in_progress', 'needs_fix', 'cancelled'],
  needs_fix: ['in_progress', 'blocked', 'cancelled'],
  approved: ['done', 'completed', 'in_progress'],
  completed: [],
  done: [],
  blocked: ['in_progress', 'failed', 'cancelled'],
  failed: ['in_progress', 'cancelled'],
  cancelled: [],
  conflict: ['in_progress', 'needs_user_decision', 'cancelled'],
  needs_user_decision: ['in_progress', 'cancelled', 'approved'],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return taskStatuses.includes(value as TaskStatus);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTaskStatusTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Invalid AgentMesa task status transition: ${from} -> ${to}`);
  }
}

export function getAllowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...allowedTransitions[from]];
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return terminalStatuses.includes(status);
}
