import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { appendMessage, listMessages, getMessagesByTask, resetMessageCounter } from '../services/message-service.js';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  resetMessageCounter();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('appendMessage', () => {
  it('creates a message with auto-generated ID', () => {
    const msg = appendMessage(paths, {
      taskId: 'T-0001',
      from: 'agent-1',
      to: 'agent-2',
      type: 'review_request',
      summary: 'Please review',
    });
    expect(msg.id).toBe('M-0001');
    expect(msg.taskId).toBe('T-0001');
    expect(msg.from).toBe('agent-1');
    expect(msg.to).toBe('agent-2');
    expect(msg.type).toBe('review_request');
    expect(msg.protocolVersion).toBe('0.1.0');
  });

  it('auto-increments message IDs', () => {
    const m1 = appendMessage(paths, { from: 'agent-1', type: 'task_created', summary: 'Created' });
    const m2 = appendMessage(paths, { from: 'agent-1', type: 'handoff', summary: 'Handoff' });
    expect(m1.id).toBe('M-0001');
    expect(m2.id).toBe('M-0002');
  });

  it('stores artifact references', () => {
    const msg = appendMessage(paths, {
      from: 'agent-1',
      type: 'review_result',
      summary: 'Review done',
      artifactIds: ['A-0001', 'A-0002'],
    });
    expect(msg.artifactIds).toEqual(['A-0001', 'A-0002']);
  });
});

describe('listMessages', () => {
  it('returns empty when no messages', () => {
    expect(listMessages(paths)).toEqual([]);
  });

  it('lists all messages', () => {
    appendMessage(paths, { from: 'agent-1', type: 'task_created', summary: 'Created' });
    appendMessage(paths, { from: 'agent-1', type: 'handoff', summary: 'Handoff' });
    expect(listMessages(paths)).toHaveLength(2);
  });
});

describe('getMessagesByTask', () => {
  it('filters messages by taskId', () => {
    appendMessage(paths, { taskId: 'T-0001', from: 'agent-1', type: 'task_created', summary: 'Created task 1' });
    appendMessage(paths, { taskId: 'T-0002', from: 'agent-1', type: 'task_created', summary: 'Created task 2' });
    appendMessage(paths, { taskId: 'T-0001', from: 'agent-1', type: 'handoff', summary: 'Handoff task 1' });

    const task1Messages = getMessagesByTask(paths, 'T-0001');
    expect(task1Messages).toHaveLength(2);
    expect(task1Messages.every((m) => m.taskId === 'T-0001')).toBe(true);

    const task2Messages = getMessagesByTask(paths, 'T-0002');
    expect(task2Messages).toHaveLength(1);
  });

  it('returns empty for unknown task', () => {
    appendMessage(paths, { taskId: 'T-0001', from: 'agent-1', type: 'task_created', summary: 'Created' });
    expect(getMessagesByTask(paths, 'T-9999')).toEqual([]);
  });
});
