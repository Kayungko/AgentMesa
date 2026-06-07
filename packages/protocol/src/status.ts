export const taskStatuses = [
  'todo',
  'in_progress',
  'ready_for_review',
  'reviewing',
  'changes_requested',
  'approved',
  'done',
  'blocked',
  'failed',
  'cancelled',
  'conflict',
  'needs_user_decision',
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['ready_for_review', 'blocked', 'failed', 'cancelled'],
  ready_for_review: ['reviewing', 'changes_requested', 'cancelled'],
  reviewing: ['approved', 'changes_requested', 'blocked', 'failed'],
  changes_requested: ['in_progress', 'cancelled'],
  approved: ['done', 'in_progress'],
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
