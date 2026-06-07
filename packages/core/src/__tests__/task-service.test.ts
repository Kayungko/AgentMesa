import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createTask, getTask, listTasks, updateTaskStatus, assignTask, deleteTask, resetTaskCounter } from '../services/task-service.js';
import { resetMessageCounter } from '../services/message-service.js';
import { TaskNotFoundError, InvalidStatusTransitionError } from '../errors.js';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  resetTaskCounter();
  resetMessageCounter();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createTask', () => {
  it('creates a task with todo status', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    expect(task.id).toBe('T-0001');
    expect(task.title).toBe('Build feature');
    expect(task.status).toBe('todo');
    expect(task.createdBy).toBe('user');
    expect(task.protocolVersion).toBe('0.1.0');
  });

  it('creates a task with assignment', () => {
    const task = createTask(paths, {
      title: 'Build feature',
      createdBy: 'user',
      assignedTo: 'agent-1',
      reviewer: 'agent-2',
    });
    expect(task.assignedTo).toBe('agent-1');
    expect(task.reviewer).toBe('agent-2');
  });

  it('creates a task with context', () => {
    const task = createTask(paths, {
      title: 'Build feature',
      createdBy: 'user',
      context: {
        goal: 'Add login',
        changedFiles: ['src/auth.ts'],
        commands: ['npm test'],
      },
    });
    expect(task.context?.goal).toBe('Add login');
    expect(task.context?.changedFiles).toEqual(['src/auth.ts']);
  });

  it('auto-increments task IDs', () => {
    const t1 = createTask(paths, { title: 'Task 1', createdBy: 'user' });
    const t2 = createTask(paths, { title: 'Task 2', createdBy: 'user' });
    expect(t1.id).toBe('T-0001');
    expect(t2.id).toBe('T-0002');
  });
});

describe('getTask', () => {
  it('retrieves a created task', () => {
    const created = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const fetched = getTask(paths, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('Build feature');
  });

  it('throws for non-existent task', () => {
    expect(() => getTask(paths, 'T-9999')).toThrow(TaskNotFoundError);
  });
});

describe('listTasks', () => {
  it('returns empty array when no tasks', () => {
    expect(listTasks(paths)).toEqual([]);
  });

  it('lists all created tasks', () => {
    createTask(paths, { title: 'Task 1', createdBy: 'user' });
    createTask(paths, { title: 'Task 2', createdBy: 'user' });
    const tasks = listTasks(paths);
    expect(tasks).toHaveLength(2);
  });
});

describe('updateTaskStatus', () => {
  it('updates status with valid transition', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const updated = updateTaskStatus(paths, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');
  });

  it('throws for invalid transition', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    expect(() => updateTaskStatus(paths, task.id, 'done')).toThrow(InvalidStatusTransitionError);
  });

  it('throws for non-existent task', () => {
    expect(() => updateTaskStatus(paths, 'T-9999', 'in_progress')).toThrow(TaskNotFoundError);
  });

  it('updates the updatedAt timestamp', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const updated = updateTaskStatus(paths, task.id, 'in_progress');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime()
    );
  });

  it('supports full happy-path lifecycle', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    let current = task;

    current = updateTaskStatus(paths, current.id, 'in_progress');
    expect(current.status).toBe('in_progress');

    current = updateTaskStatus(paths, current.id, 'ready_for_review');
    expect(current.status).toBe('ready_for_review');

    current = updateTaskStatus(paths, current.id, 'reviewing');
    expect(current.status).toBe('reviewing');

    current = updateTaskStatus(paths, current.id, 'approved');
    expect(current.status).toBe('approved');

    current = updateTaskStatus(paths, current.id, 'done');
    expect(current.status).toBe('done');
  });
});

describe('assignTask', () => {
  it('assigns builder to task', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const updated = assignTask(paths, task.id, 'agent-claude');
    expect(updated.assignedTo).toBe('agent-claude');
  });

  it('assigns builder and reviewer', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const updated = assignTask(paths, task.id, 'agent-claude', 'agent-codex');
    expect(updated.assignedTo).toBe('agent-claude');
    expect(updated.reviewer).toBe('agent-codex');
  });
});

describe('deleteTask', () => {
  it('deletes an existing task', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const result = deleteTask(paths, task.id);
    expect(result).toBe(true);
    expect(() => getTask(paths, task.id)).toThrow(TaskNotFoundError);
  });

  it('throws for non-existent task', () => {
    expect(() => deleteTask(paths, 'T-9999')).toThrow(TaskNotFoundError);
  });
});
