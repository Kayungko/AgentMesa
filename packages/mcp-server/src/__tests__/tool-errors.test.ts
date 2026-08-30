import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import {
  createRuntimeContext,
  initWorkspace,
  createTask,
  LockError,
  TaskNotFoundError,
  InvalidStatusTransitionError,
  PolicyDeniedError,
  createRoomStore,
  type MesaRuntimeContext,
} from '@agentmesa/core';
import {
  handleUpdateStatus,
  handleListRuns,
  handleRegisterAgent,
  handleReadTask,
  handleExecRun,
  handleCreateRun,
  handleListRoomMessages,
  handleSendRoomMessage,
  handlePollRooms,
  handleCreateRoom,
  handleInviteToRoom,
  handleReadWorkflow,
  handleListMessages,
  handleGetTaskEvents,
} from '../tools.js';
import {
  toolErrorResult,
  describeToolError,
  toolError,
  ToolError,
} from '../tool-errors.js';
import { expectToolError, expectToolErrorResult } from './tool-error-contract.js';

let testDir: string;
let ctx: MesaRuntimeContext;
let taskId: string;
let homeDir: string;
const prevHome = process.env['AGENTMESA_HOME'];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-tool-errors-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    // actor id "agent:codex" normalizes to member ref "codex".
    actor: { id: 'agent:codex', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  taskId = createTask(ctx, { title: 'Contract test task', createdBy: 'agent:codex' }).id;
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-tool-errors-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe('tool error contract — invalid_value', () => {
  it('rejects an invalid task status with the legal values', async () => {
    const error = await expectToolError(() =>
      handleUpdateStatus(ctx, { taskId, status: 'complted' }),
    );
    expect(error.what).toContain('status');
    expect(error.what).toContain('complted');
    expect(error.fix).toContain('completed');
  });

  it('rejects an invalid run status filter instead of silently returning []', async () => {
    const error = await expectToolError(() => handleListRuns(ctx, { status: 'finsihed' }));
    expect(error.what).toContain('finsihed');
    expect(error.fix).toContain('failed');
  });

  it('rejects an invalid agent role with the full legal list', async () => {
    const error = await expectToolError(() =>
      handleRegisterAgent(ctx, {
        id: 'agent-x',
        name: 'X',
        client: 'cli',
        roles: ['superadmin'],
      }),
    );
    expect(error.what).toContain('superadmin');
    expect(error.fix).toContain('builder');
    expect(error.fix).toContain('reviewer');
  });

  it('translates Zod validation failures into the contract', () => {
    const parsed = z.object({ status: z.string().min(1) }).safeParse({});
    expect(parsed.success).toBe(false);
    const details = describeToolError('mesa_update_status', parsed.error);
    expect(details.code).toBe('invalid_value');
    expect(details.what).toContain('status');
    expect(details.fix.length).toBeGreaterThan(10);
  });
});

describe('tool error contract — unknown_id', () => {
  it('translates core TaskNotFoundError with a discovery hint', () => {
    let caught: unknown;
    try {
      handleReadTask(ctx, { taskId: 'T-9999' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TaskNotFoundError);
    const result = toolErrorResult('mesa_read_task', caught);
    const details = expectToolErrorResult(result);
    expect(details.code).toBe('unknown_id');
    expect(details.what).toContain('T-9999');
    expect(details.fix).toContain('mesa_list_tasks');
    // The original message survives for backward compatibility.
    expect(details.message).toContain('Task not found');
  });

  it('rejects unknown workflow ids with a discovery hint', async () => {
    const error = await expectToolError(() =>
      handleReadWorkflow(ctx, { workflowId: 'no-such-workflow' }),
    );
    expect(error.fix).toContain('mesa_list_workflows');
  });

  it('list_room_messages rejects unknown rooms instead of returning []', () => {
    let caught: unknown;
    try {
      handleListRoomMessages(ctx, { roomId: 'room_missing' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const details = expectToolErrorResult(toolErrorResult('mesa_list_room_messages', caught));
    expect(details.code).toBe('unknown_id');
    expect(details.fix).toContain('mesa_list_rooms');
  });

  it('get_task_events rejects unknown tasks instead of returning []', () => {
    expect(() => handleGetTaskEvents(ctx, { taskId: 'T-9999' })).toThrow(/Task not found/);
  });

  it('list_messages rejects unknown task filters instead of returning []', () => {
    expect(() => handleListMessages(ctx, { taskId: 'T-9999' })).toThrow(/Task not found/);
  });
});

describe('tool error contract — permission_denied', () => {
  it('translates core PolicyDeniedError with a role-repair hint', async () => {
    const readOnlyCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:viewer', type: 'agent', roles: ['read_only'], client: 'mcp' },
    });
    let caught: unknown;
    try {
      handleCreateRoom(readOnlyCtx, { name: '不该建的群' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyDeniedError);
    const details = expectToolErrorResult(toolErrorResult('mesa_create_room', caught));
    expect(details.code).toBe('permission_denied');
    expect(details.fix).toContain('role');
  });

  it('poll_rooms explains that only your own ref may be polled', async () => {
    const error = await expectToolError(() => handlePollRooms(ctx, { ref: 'claude' }));
    expect(error.what).toContain('does not match actor');
    expect(error.fix).toContain('codex');
  });

  it('send_room_message rejects impersonation with the correct fromRef', async () => {
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as { id: string };
    handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: 'ws-test',
      kind: 'agent',
      ref: 'codex',
    });
    const error = await expectToolError(() =>
      handleSendRoomMessage(ctx, {
        roomId: room.id,
        workspaceId: 'ws-test',
        fromKind: 'agent',
        fromRef: 'claude',
        summary: '冒充 claude',
      }),
    );
    expect(error.what).toContain('impersonation rejected');
    expect(error.fix).toContain('"codex"');
  });
});

describe('tool error contract — precondition_not_met', () => {
  it('exec_run explains the pending-only precondition with the run status', async () => {
    const run = JSON.parse(
      handleCreateRun(ctx, { agentId: 'builder-1', input: 'Do work', taskId }),
    ) as { id: string };
    await handleExecRun(ctx, { runId: run.id }); // completes the run
    const error = await expectToolError(() => handleExecRun(ctx, { runId: run.id }));
    expect(error.what).toContain('completed');
    expect(error.fix).toContain('mesa_create_run');
  });

  it('send_room_message explains how to invite a non-member sender', async () => {
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as { id: string };
    const error = await expectToolError(() =>
      handleSendRoomMessage(ctx, {
        roomId: room.id,
        workspaceId: 'ws-test',
        fromKind: 'agent',
        fromRef: 'codex',
        summary: '还没被邀请',
      }),
    );
    expect(error.what).toContain('not a member');
    expect(error.fix).toContain('mesa_invite_to_room');
    expect(error.fix).toContain(room.id);
  });

  it('send_room_message explains ghost mentions', async () => {
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as { id: string };
    handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: 'ws-test',
      kind: 'agent',
      ref: 'codex',
    });
    const error = await expectToolError(() =>
      handleSendRoomMessage(ctx, {
        roomId: room.id,
        workspaceId: 'ws-test',
        fromKind: 'agent',
        fromRef: 'codex',
        summary: '@ghost 你在吗',
        mentions: ['ghost'],
      }),
    );
    expect(error.what).toContain('non-members');
    expect(error.what).toContain('ghost');
    expect(error.fix).toContain('mesa_invite_to_room');
  });

  it('translates invalid status transitions with a read-first hint', () => {
    const details = describeToolError(
      'mesa_update_status',
      new InvalidStatusTransitionError('todo', 'done'),
    );
    expect(details.code).toBe('precondition_not_met');
    expect(details.fix).toContain('mesa_read_task');
  });
});

describe('tool error contract — conflict', () => {
  it('translates lock errors with a retry hint', () => {
    const details = describeToolError(
      'mesa_update_status',
      new LockError('task:1', 'timed out after 100ms — already locked by other'),
    );
    expect(details.code).toBe('conflict');
    expect(details.fix).toContain('retry');
  });
});

describe('tool error contract — internal', () => {
  it('wraps unexpected errors without losing the message', () => {
    const details = describeToolError('mesa_read_task', new Error('boom'));
    expect(details.code).toBe('internal');
    expect(details.what).toContain('boom');
    expect(details.fix.length).toBeGreaterThan(10);
  });

  it('covers non-Error throwables', () => {
    const details = describeToolError('mesa_read_task', 'plain string failure');
    expect(details.code).toBe('internal');
    expect(details.what).toContain('plain string failure');
  });
});

describe('stale cursor guidance', () => {
  it('tells the agent to re-fetch a cursor instead of silently skipping', () => {
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as { id: string };
    handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: 'ws-test',
      kind: 'agent',
      ref: 'codex',
    });
    handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: 'ws-test',
      fromKind: 'agent',
      fromRef: 'codex',
      summary: '第一条',
    });
    let caught: unknown;
    try {
      handleListRoomMessages(ctx, { roomId: room.id, after: 'msg_stale' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const details = expectToolErrorResult(toolErrorResult('mesa_list_room_messages', caught));
    expect(details.code).toBe('invalid_value');
    expect(details.fix).toContain('cursor');
  });
});

describe('ToolError basics', () => {
  it('is a plain Error whose message carries what and fix', () => {
    const error = toolError(
      'unknown_id',
      'No entity found for roomId "room_x".',
      'Call mesa_list_rooms to discover valid room IDs, then retry with an existing roomId.',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('room_x');
    expect(error.message).toContain('Fix:');
  });

  it('passes ToolErrors through describeToolError unchanged (plus the tool name)', () => {
    const original = toolError('conflict', 'Lock held elsewhere.', 'Retry shortly.');
    const details = describeToolError('mesa_create_task', original);
    expect(details).toMatchObject({
      tool: 'mesa_create_task',
      code: 'conflict',
      what: 'Lock held elsewhere.',
      fix: 'Retry shortly.',
    });
    expect(new ToolError('conflict', 'w', 'f').why.length).toBeGreaterThan(0);
  });

  it('exposes the room store cursor error through the real store', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: 'cursor room' });
    store.invite(room.id, { workspaceId: 'ws-test', kind: 'agent', ref: 'codex' });
    store.sendMessage(room.id, {
      workspaceId: 'ws-test',
      from: { workspaceId: 'ws-test', kind: 'agent', ref: 'codex' },
      summary: 'seed message',
    });
    expect(() => store.listMessages(room.id, 'garbage-cursor')).toThrow(/Unknown room message cursor/);
  });
});
