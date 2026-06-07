import { join } from 'node:path';
import {
  MesaTaskSchema,
  CreateTaskInputSchema,
  mesaProtocolVersion,
} from '@agentmesa/protocol';
import type { MesaTask, CreateTaskInput, TaskStatus } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import { readJson, writeJson, listJson, deleteFile } from '../storage.js';
import { TaskNotFoundError, InvalidStatusTransitionError, ValidationError } from '../errors.js';
import { canTransitionTaskStatus } from '@agentmesa/protocol';
import { appendMessage } from './message-service.js';

let taskCounter = 0;

function generateTaskId(): string {
  taskCounter++;
  return `T-${String(taskCounter).padStart(4, '0')}`;
}

export function resetTaskCounter(): void {
  taskCounter = 0;
}

export function createTask(paths: MesaWorkspacePaths, input: CreateTaskInput): MesaTask {
  const validated = CreateTaskInputSchema.parse(input);

  const now = new Date().toISOString();
  const task: MesaTask = {
    protocolVersion: mesaProtocolVersion,
    id: generateTaskId(),
    title: validated.title,
    status: 'todo',
    createdBy: validated.createdBy,
    assignedTo: validated.assignedTo,
    reviewer: validated.reviewer,
    meetingId: validated.meetingId,
    branch: validated.branch,
    context: validated.context,
    createdAt: now,
    updatedAt: now,
  };

  const result = MesaTaskSchema.parse(task);
  writeJson(join(paths.tasksDir, `${task.id}.json`), result);

  appendMessage(paths, {
    taskId: task.id,
    from: task.createdBy,
    type: 'task_created',
    summary: `Task "${task.title}" created`,
  });

  return result;
}

export function getTask(paths: MesaWorkspacePaths, taskId: string): MesaTask {
  const task = readJson<MesaTask>(join(paths.tasksDir, `${taskId}.json`));
  if (!task) {
    throw new TaskNotFoundError(taskId);
  }
  return MesaTaskSchema.parse(task);
}

export function listTasks(paths: MesaWorkspacePaths): MesaTask[] {
  return listJson<MesaTask>(paths.tasksDir)
    .map((t) => MesaTaskSchema.safeParse(t))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaTask }).data);
}

export function updateTaskStatus(
  paths: MesaWorkspacePaths,
  taskId: string,
  newStatus: TaskStatus,
  updatedBy?: string
): MesaTask {
  const task = getTask(paths, taskId);

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
  writeJson(join(paths.tasksDir, `${taskId}.json`), result);

  appendMessage(paths, {
    taskId,
    from: updatedBy ?? 'system',
    type: 'status_changed',
    summary: `Status changed: ${oldStatus} -> ${newStatus}`,
  });

  return result;
}

export function assignTask(
  paths: MesaWorkspacePaths,
  taskId: string,
  assignedTo: string,
  reviewer?: string
): MesaTask {
  const task = getTask(paths, taskId);

  const updated: MesaTask = {
    ...task,
    assignedTo,
    reviewer: reviewer ?? task.reviewer,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaTaskSchema.parse(updated);
  writeJson(join(paths.tasksDir, `${taskId}.json`), result);

  return result;
}

export function deleteTask(paths: MesaWorkspacePaths, taskId: string): boolean {
  const filePath = join(paths.tasksDir, `${taskId}.json`);
  if (!readJson(filePath)) {
    throw new TaskNotFoundError(taskId);
  }
  return deleteFile(filePath);
}
