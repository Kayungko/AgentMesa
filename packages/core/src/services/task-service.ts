import { join } from 'node:path';
import {
  MesaTaskSchema,
  CreateTaskInputSchema,
  currentProtocolVersion,
  generateTaskId,
  canTransitionTaskStatus,
} from '@agentmesa/protocol';
import type {
  MesaTask,
  CreateTaskInput,
  TaskStatus,
} from '@agentmesa/protocol';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  TaskNotFoundError,
  InvalidStatusTransitionError,
} from '../errors.js';
import { appendMessage } from './message-service.js';
import { createMeeting } from './meeting-service.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export type CreateTaskRuntimeInput = Omit<CreateTaskInput, 'createdBy'> & {
  createdBy?: string;
};

export function createTask(
  ctx: MesaRuntimeContext,
  input: CreateTaskRuntimeInput
): MesaTask {
  assertPolicy(ctx, 'task.create', 'task');
  const validated = CreateTaskInputSchema.parse({
    ...input,
    createdBy: ctx.actor.id,
  });

  const meetingId =
    validated.meetingId ??
    createMeeting(ctx, { title: `Meeting for ${validated.title}` }).id;

  const now = new Date().toISOString();
  const task: MesaTask = {
    protocolVersion: currentProtocolVersion,
    id: generateTaskId(),
    title: validated.title,
    status: 'todo',
    createdBy: validated.createdBy,
    assignedTo: validated.assignedTo,
    reviewer: validated.reviewer,
    meetingId,
    branch: validated.branch,
    priority: validated.priority ?? 'normal',
    kind: validated.kind ?? 'implement',
    context: validated.context,
    createdAt: now,
    updatedAt: now,
  };

  const result = MesaTaskSchema.parse(task);
  writeTask(ctx, result);

  appendMessage(ctx, {
    meetingId,
    taskId: task.id,
    type: 'task_created',
    summary: `Task "${task.title}" created`,
  });

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'task_created',
    streamId: task.id,
    streamType: 'task',
    data: { task: result },
  });

  return result;
}

export function getTask(ctx: MesaRuntimeContext, taskId: string): MesaTask {
  const task = readJsonFromStorage<MesaTask>(
    ctx,
    join(ctx.paths.tasksDir, `${taskId}.json`)
  );
  if (!task) {
    throw new TaskNotFoundError(taskId);
  }

  return MesaTaskSchema.parse(task);
}

export function listTasks(ctx: MesaRuntimeContext): MesaTask[] {
  return listJsonFromStorage<MesaTask>(ctx, ctx.paths.tasksDir)
    .map((t) => MesaTaskSchema.safeParse(t))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaTask }).data);
}

export function updateTaskStatus(
  ctx: MesaRuntimeContext,
  taskId: string,
  newStatus: TaskStatus
): MesaTask {
  assertPolicy(ctx, 'task.updateStatus', `task:${taskId}`);
  const task = getTask(ctx, taskId);

  if (!canTransitionTaskStatus(task.status, newStatus)) {
    throw new InvalidStatusTransitionError(task.status, newStatus);
  }

  const oldStatus = task.status;
  const updated: MesaTask = {
    ...task,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaTaskSchema.parse(updated);
  writeTask(ctx, result);

  appendMessage(ctx, {
    meetingId: task.meetingId,
    taskId,
    type: 'status_changed',
    summary: `Status changed: ${oldStatus} -> ${newStatus}`,
  });

  appendRuntimeEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_status_changed',
    streamId: taskId,
    streamType: 'task',
    data: { oldStatus, newStatus },
  });

  return result;
}

export function assignTask(
  ctx: MesaRuntimeContext,
  taskId: string,
  assignedTo: string,
  reviewer?: string
): MesaTask {
  assertPolicy(ctx, 'task.assign', `task:${taskId}`);
  const task = getTask(ctx, taskId);

  const updated: MesaTask = {
    ...task,
    assignedTo,
    assignedBuilder: assignedTo,
    reviewer: reviewer ?? task.reviewer,
    assignedReviewer: reviewer ?? task.assignedReviewer,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaTaskSchema.parse(updated);
  writeTask(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_assigned',
    streamId: taskId,
    streamType: 'task',
    data: {
      assignedTo,
      reviewer: reviewer ?? task.reviewer,
    },
  });

  return result;
}

/**
 * Hard-deletes the task file. The task is removed from the filesystem.
 * A {@link task_deleted} event is emitted; projection rebuild produces a tombstone
 * (deleted=true, deletedAt=timestamp).
 *
 * Prefer {@link archiveTask} when you need to preserve the task record and only
 * mark it as inactive.
 */
export function deleteTask(ctx: MesaRuntimeContext, taskId: string): boolean {
  assertPolicy(ctx, 'task.delete', `task:${taskId}`);
  const task = getTask(ctx, taskId);
  const filePath = join(ctx.paths.tasksDir, `${taskId}.json`);
  const deleted = ctx.storage.delete(filePath);

  appendRuntimeEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_deleted',
    streamId: taskId,
    streamType: 'task',
    data: { taskId },
  });

  return deleted;
}

/**
 * Soft-archives a task. The task file is preserved and marked with archived=true;
 * an {@link task_archived} event is emitted. Unlike {@link deleteTask}, the task
 * file remains readable on disk — it is simply excluded from active-task queries.
 *
 * Projection rebuild treats task_archived the same as task_deleted: the
 * projection is marked deleted=true with deletedAt set to the event timestamp.
 */
export function archiveTask(ctx: MesaRuntimeContext, taskId: string): MesaTask {
  assertPolicy(ctx, 'task.archive', `task:${taskId}`);
  const task = getTask(ctx, taskId);

  const archived: MesaTask = {
    ...task,
    archived: true,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaTaskSchema.parse(archived);
  writeTask(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_archived',
    streamId: taskId,
    streamType: 'task',
    data: { taskId },
  });

  return result;
}

function writeTask(ctx: MesaRuntimeContext, task: MesaTask): void {
  writeJsonToStorage(ctx, join(ctx.paths.tasksDir, `${task.id}.json`), task);
}
