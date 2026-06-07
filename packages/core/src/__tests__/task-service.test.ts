import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createTask, getTask, listTasks, updateTaskStatus, assignTask, deleteTask } from '../services/task-service.js';
import { TaskNotFoundError, InvalidStatusTransitionError } from '../errors.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createTask', () => {
  it('creates a task with todo status', () => {
    const task = createTask(ctx, { title: 'Build feature', createdBy: 'spoofed' });
    expect(task.id).toMatch(/^task_/);
    expect(task.title).toBe('Build feature');
    expect(task.status).toBe('todo');
    expect(task.createdBy).toBe('user:test');
    expect(task.protocolVersion).toBe('0.2.0');
  });

  it('creates a task with assignment', () => {
    const task = createTask(ctx, {
      title: 'Build feature',
      createdBy: 'user',
      assignedTo: 'agent-1',
      reviewer: 'agent-2',
    });
    expect(task.assignedTo).toBe('agent-1');
    expect(task.reviewer).toBe('agent-2');
  });

  it('creates a task with context', () => {
    const task = createTask(ctx, {
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

  it('generates unique task IDs', () => {
    const t1 = createTask(ctx, { title: 'Task 1' });
    const t2 = createTask(ctx, { title: 'Task 2' });
    expect(t1.id).toMatch(/^task_/);
    expect(t2.id).toMatch(/^task_/);
    expect(t1.id).not.toBe(t2.id);
  });
});

describe('getTask', () => {
  it('retrieves a created task', () => {
    const created = createTask(ctx, { title: 'Build feature' });
    const fetched = getTask(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('Build feature');
  });

  it('throws for non-existent task', () => {
    expect(() => getTask(ctx, 'T-9999')).toThrow(TaskNotFoundError);
  });
});

describe('listTasks', () => {
  it('returns empty array when no tasks', () => {
    expect(listTasks(ctx)).toEqual([]);
  });

  it('lists all created tasks', () => {
    createTask(ctx, { title: 'Task 1' });
    createTask(ctx, { title: 'Task 2' });
    const tasks = listTasks(ctx);
    expect(tasks).toHaveLength(2);
  });
});

describe('updateTaskStatus', () => {
  it('updates status with valid transition', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = updateTaskStatus(ctx, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');
  });

  it('throws for invalid transition', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    expect(() => updateTaskStatus(ctx, task.id, 'done')).toThrow(InvalidStatusTransitionError);
  });

  it('throws for non-existent task', () => {
    expect(() => updateTaskStatus(ctx, 'T-9999', 'in_progress')).toThrow(TaskNotFoundError);
  });

  it('updates the updatedAt timestamp', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = updateTaskStatus(ctx, task.id, 'in_progress');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime()
    );
  });

  it('supports full happy-path lifecycle', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let current = task;

    current = updateTaskStatus(ctx, current.id, 'in_progress');
    expect(current.status).toBe('in_progress');

    current = updateTaskStatus(ctx, current.id, 'ready_for_review');
    expect(current.status).toBe('ready_for_review');

    current = updateTaskStatus(ctx, current.id, 'reviewing');
    expect(current.status).toBe('reviewing');

    current = updateTaskStatus(ctx, current.id, 'approved');
    expect(current.status).toBe('approved');

    current = updateTaskStatus(ctx, current.id, 'done');
    expect(current.status).toBe('done');
  });
});

describe('assignTask', () => {
  it('assigns builder to task', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = assignTask(ctx, task.id, 'agent-claude');
    expect(updated.assignedTo).toBe('agent-claude');
  });

  it('assigns builder and reviewer', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = assignTask(ctx, task.id, 'agent-claude', 'agent-codex');
    expect(updated.assignedTo).toBe('agent-claude');
    expect(updated.reviewer).toBe('agent-codex');
  });
});

describe('deleteTask', () => {
  it('deletes an existing task', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const result = deleteTask(ctx, task.id);
    const events = ctx.eventStore.list({ streamId: task.id });

    expect(result).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'task_created',
      'task_deleted',
    ]);
    expect(events.every((event) => event.actor === 'user:test')).toBe(true);
    expect(() => getTask(ctx, task.id)).toThrow(TaskNotFoundError);
  });

  it('throws for non-existent task', () => {
    expect(() => deleteTask(ctx, 'T-9999')).toThrow(TaskNotFoundError);
  });
});

describe('runtime context integration', () => {
  it('records task events with the runtime actor', () => {
    const task = createTask(ctx, { title: 'Audited task' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const events = ctx.eventStore.list({ streamId: task.id });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.actor === 'user:test')).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'task_created',
      'task_status_changed',
    ]);
  });

  it('rejects mutations denied by policy', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:blocked', type: 'agent', roles: ['reviewer'] },
      policy: {
        can: () => ({ allowed: false, reason: 'read only' }),
      },
    });

    expect(() => createTask(deniedCtx, { title: 'Blocked task' })).toThrow(
      'Policy denied'
    );
  });
});
