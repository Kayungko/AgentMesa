import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { appendMessage, listMessages, getMessagesByTask } from '../services/message-service.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'agent:test', type: 'agent', roles: ['reviewer'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('appendMessage', () => {
  it('creates a message with auto-generated ID', () => {
    const msg = appendMessage(ctx, {
      taskId: 'T-0001',
      from: 'spoofed-agent',
      to: 'agent-2',
      type: 'review_request',
      summary: 'Please review',
    });
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.taskId).toBe('T-0001');
    expect(msg.from).toBe('agent:test');
    expect(msg.to).toBe('agent-2');
    expect(msg.type).toBe('review_request');
    expect(msg.protocolVersion).toBe('0.2.0');
  });

  it('generates unique message IDs', () => {
    const m1 = appendMessage(ctx, { type: 'task_created', summary: 'Created' });
    const m2 = appendMessage(ctx, { type: 'handoff', summary: 'Handoff' });
    expect(m1.id).toMatch(/^msg_/);
    expect(m2.id).toMatch(/^msg_/);
    expect(m1.id).not.toBe(m2.id);
  });

  it('stores artifact references', () => {
    const msg = appendMessage(ctx, {
      type: 'review_result',
      summary: 'Review done',
      artifactIds: ['A-0001', 'A-0002'],
    });
    expect(msg.artifactIds).toEqual(['A-0001', 'A-0002']);
  });
});

describe('listMessages', () => {
  it('returns empty when no messages', () => {
    expect(listMessages(ctx)).toEqual([]);
  });

  it('lists all messages', () => {
    appendMessage(ctx, { type: 'task_created', summary: 'Created' });
    appendMessage(ctx, { type: 'handoff', summary: 'Handoff' });
    expect(listMessages(ctx)).toHaveLength(2);
  });
});

describe('getMessagesByTask', () => {
  it('filters messages by taskId', () => {
    appendMessage(ctx, { taskId: 'T-0001', type: 'task_created', summary: 'Created task 1' });
    appendMessage(ctx, { taskId: 'T-0002', type: 'task_created', summary: 'Created task 2' });
    appendMessage(ctx, { taskId: 'T-0001', type: 'handoff', summary: 'Handoff task 1' });

    const task1Messages = getMessagesByTask(ctx, 'T-0001');
    expect(task1Messages).toHaveLength(2);
    expect(task1Messages.every((m) => m.taskId === 'T-0001')).toBe(true);

    const task2Messages = getMessagesByTask(ctx, 'T-0002');
    expect(task2Messages).toHaveLength(1);
  });

  it('returns empty for unknown task', () => {
    appendMessage(ctx, { taskId: 'T-0001', type: 'task_created', summary: 'Created' });
    expect(getMessagesByTask(ctx, 'T-9999')).toEqual([]);
  });
});

describe('runtime context integration', () => {
  it('records message events with runtime actor', () => {
    const message = appendMessage(ctx, { type: 'general', summary: 'Hello' });
    const events = ctx.eventStore.list({ streamId: message.id });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('message_sent');
    expect(events[0]!.actor).toBe('agent:test');
  });

  it('rejects messages denied by policy', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:blocked', type: 'agent', roles: ['reviewer'] },
      policy: { can: () => ({ allowed: false, reason: 'blocked' }) },
    });

    expect(() => appendMessage(deniedCtx, { type: 'general', summary: 'Nope' })).toThrow(
      'Policy denied'
    );
  });
});
