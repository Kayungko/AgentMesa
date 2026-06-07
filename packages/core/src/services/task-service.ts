import { join } from 'node:path';
import {
  MesaTaskSchema,
  MesaEventSchema,
  CreateTaskInputSchema,
  currentProtocolVersion,
  generateEventId,
  generateTaskId,
  canTransitionTaskStatus,
} from '@agentmesa/protocol';
import type {
  MesaEvent,
  MesaTask,
  CreateTaskInput,
  TaskStatus,
} from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { readJson, deleteFile } from '../storage.js';
import {
  TaskNotFoundError,
  InvalidStatusTransitionError,
  PolicyDeniedError,
} from '../errors.js';
import { appendMessage } from './message-service.js';
import { createMeeting } from './meeting-service.js';

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
    createMeeting(ctx.paths, { title: `Meeting for ${validated.title}` }).id;

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

  appendMessage(ctx.paths, {
    meetingId,
    taskId: task.id,
    from: ctx.actor.id,
    type: 'task_created',
    summary: `Task "${task.title}" created`,
  });

  appendTaskEvent(ctx, {
    meetingId,
    type: 'task_created',
    streamId: task.id,
    data: { task: result },
  });

  return result;
}

export function getTask(ctx: MesaRuntimeContext, taskId: string): MesaTask {
  const content = ctx.storage.readText(join(ctx.paths.tasksDir, `${taskId}.json`));
  if (content === null) {
    throw new TaskNotFoundError(taskId);
  }

  return MesaTaskSchema.parse(JSON.parse(content));
}

export function listTasks(ctx: MesaRuntimeContext): MesaTask[] {
  return ctx.storage
    .list(ctx.paths.tasksDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => ctx.storage.readText(join(ctx.paths.tasksDir, fileName)))
    .filter((content): content is string => content !== null)
    .map((content) => MesaTaskSchema.safeParse(JSON.parse(content)))
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

  appendMessage(ctx.paths, {
    meetingId: task.meetingId,
    taskId,
    from: ctx.actor.id,
    type: 'status_changed',
    summary: `Status changed: ${oldStatus} -> ${newStatus}`,
  });

  appendTaskEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_status_changed',
    streamId: taskId,
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

  appendTaskEvent(ctx, {
    meetingId: task.meetingId,
    type: 'task_assigned',
    streamId: taskId,
    data: {
      assignedTo,
      reviewer: reviewer ?? task.reviewer,
    },
  });

  return result;
}

export function deleteTask(paths: MesaWorkspacePaths, taskId: string): boolean {
  const filePath = join(paths.tasksDir, `${taskId}.json`);
  if (!readJson(filePath)) {
    throw new TaskNotFoundError(taskId);
  }
  return deleteFile(filePath);
}

function writeTask(ctx: MesaRuntimeContext, task: MesaTask): void {
  ctx.storage.writeText(
    join(ctx.paths.tasksDir, `${task.id}.json`),
    `${JSON.stringify(task, null, 2)}\n`
  );
}

function assertPolicy(
  ctx: MesaRuntimeContext,
  action: string,
  resource: string
): void {
  const decision = ctx.policy.can(ctx.actor, action, resource);
  if (!decision.allowed) {
    throw new PolicyDeniedError(action, resource, decision.reason);
  }
}

function appendTaskEvent(
  ctx: MesaRuntimeContext,
  input: Pick<MesaEvent, 'meetingId' | 'type' | 'streamId' | 'data'>
): void {
  const sequence = ctx.eventStore.list({ streamId: input.streamId }).length;
  const event = MesaEventSchema.parse({
    protocolVersion: currentProtocolVersion,
    id: generateEventId(),
    meetingId: input.meetingId,
    type: input.type,
    streamId: input.streamId,
    streamType: 'task',
    data: input.data,
    actor: ctx.actor.id,
    sequence,
    timestamp: new Date().toISOString(),
  });
  ctx.eventStore.append(event);
}
