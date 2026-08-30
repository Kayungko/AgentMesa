import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace, addWorkspace, createMeeting, registerAgent, PolicyDeniedError } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaRoom, RoomMessage } from '@agentmesa/protocol';
import {
  handleCreateRoom,
  handleListRooms,
  handleInviteToRoom,
  handleSendRoomMessage,
  handleListRoomMessages,
  handleLeaveRoom,
  handlePollRooms,
} from '../tools.js';

let testDir: string;
let ctx: MesaRuntimeContext;
const prevHome = process.env['AGENTMESA_HOME'];
let homeDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-room-mcp-'));
  initWorkspace(testDir);
  // actor id "agent:codex" 归一化后对应成员 ref "codex"（M1 防冒充约定）。
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'agent:codex', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-room-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
  // Register the workspace so label resolution can read it.
  addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
});

afterEach(() => {
  vi.useRealTimers();
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe('room MCP tools', () => {
  it('creates and lists rooms', () => {
    const created = handleCreateRoom(ctx, { name: '跨项目评审群' });
    const room = JSON.parse(created) as MesaRoom;
    expect(room.id).toMatch(/^room_/);

    const listed = handleListRooms(ctx);
    const rooms = JSON.parse(listed) as MesaRoom[];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.id).toBe(room.id);
  });

  it('invites a session and resolves its label from the workspace', () => {
    const meeting = createMeeting(ctx, { title: 'Idel-Game 评审会' });
    const workspace = addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as MesaRoom;

    const invited = JSON.parse(handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      kind: 'session',
      ref: meeting.id,
    })) as MesaRoom;

    expect(invited.members).toHaveLength(1);
    expect(invited.members[0]!.label).toBe('Idel-Game 评审会');
    expect(invited.members[0]!.kind).toBe('session');
  });

  it('sends and lists room messages', () => {
    const workspace = addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as MesaRoom;
    handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      kind: 'agent',
      ref: 'codex',
      label: 'Codex',
    });

    const sent = JSON.parse(handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      fromKind: 'agent',
      fromRef: 'codex',
      fromLabel: 'Codex',
      summary: '跨 workspace 第一条',
      origin: 'agent',
      body: '完整正文',
    })) as RoomMessage;
    expect(sent.roomId).toBe(room.id);
    expect(sent.workspaceId).toBe(workspace.id);
    expect(sent.origin).toBe('agent');
    expect(sent.body).toBe('完整正文');

    const listed = JSON.parse(handleListRoomMessages(ctx, { roomId: room.id })) as RoomMessage[];
    expect(listed).toHaveLength(1);
    expect(listed[0]!.summary).toBe('跨 workspace 第一条');
  });

  it('rejects a sender whose ref does not match the MCP actor (impersonation)', () => {
    const workspace = addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as MesaRoom;
    // 两个成员都在群里，但 actor 是 agent:codex，不能以 claude 的名义发言。
    handleInviteToRoom(ctx, { roomId: room.id, workspaceId: workspace.id, kind: 'agent', ref: 'codex' });
    handleInviteToRoom(ctx, { roomId: room.id, workspaceId: workspace.id, kind: 'agent', ref: 'claude' });

    expect(() => handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      fromKind: 'agent',
      fromRef: 'claude',
      summary: '冒充 claude',
    })).toThrow(/impersonation rejected/);
  });

  it('polls rooms for the calling member with cursors', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const workspace = addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
    const room = JSON.parse(handleCreateRoom(ctx, { name: '投票群' })) as MesaRoom;
    handleInviteToRoom(ctx, { roomId: room.id, workspaceId: workspace.id, kind: 'agent', ref: 'codex' });

    // 首轮：无游标，只返回摘要 + 最新一条。
    handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      fromKind: 'agent',
      fromRef: 'codex',
      summary: '第一条',
    });
    const first = JSON.parse(handlePollRooms(ctx, { ref: 'codex' })) as {
      rooms: Array<{ roomId: string; cursor: string | null; messages: RoomMessage[]; lastMessageAt: string | null }>;
    };
    expect(first.rooms).toHaveLength(1);
    expect(first.rooms[0]!.roomId).toBe(room.id);
    expect(first.rooms[0]!.messages).toHaveLength(1);
    expect(first.rooms[0]!.messages[0]!.summary).toBe('第一条');
    expect(first.rooms[0]!.lastMessageAt).toBe(first.rooms[0]!.messages[0]!.createdAt);
    const cursor = first.rooms[0]!.cursor!;
    expect(cursor).toBe(first.rooms[0]!.messages[0]!.id);

    // 第二轮：带游标，只返回新消息。
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      fromKind: 'agent',
      fromRef: 'codex',
      summary: '第二条',
    });
    const second = JSON.parse(handlePollRooms(ctx, { ref: 'codex', cursors: { [room.id]: cursor } })) as {
      rooms: Array<{ roomId: string; cursor: string | null; messages: RoomMessage[] }>;
    };
    expect(second.rooms[0]!.messages.map((m) => m.summary)).toEqual(['第二条']);
    // 游标推进到最后一条消息 id。
    expect(second.rooms[0]!.cursor).toBe(second.rooms[0]!.messages[0]!.id);
  });

  it('rejects polling rooms on behalf of another member', () => {
    expect(() => handlePollRooms(ctx, { ref: 'claude' })).toThrow(/does not match actor/);
  });

  it('denies room writes for a read_only actor via policy', () => {
    const readOnlyCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:viewer', type: 'agent', roles: ['read_only'], client: 'mcp' },
    });
    expect(() => handleCreateRoom(readOnlyCtx, { name: '不该建的群' })).toThrow(PolicyDeniedError);
    expect(() => handleSendRoomMessage(readOnlyCtx, {
      roomId: 'room_x',
      workspaceId: 'ws_x',
      fromKind: 'agent',
      fromRef: 'viewer',
      summary: '不该发的消息',
    })).toThrow(PolicyDeniedError);
  });

  it('leaves a room', () => {
    const workspace = addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
    const room = JSON.parse(handleCreateRoom(ctx, { name: '群' })) as MesaRoom;
    handleInviteToRoom(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      kind: 'agent',
      ref: 'codex',
      label: 'Codex',
    });
    const after = JSON.parse(handleLeaveRoom(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      kind: 'agent',
      ref: 'codex',
    })) as MesaRoom;
    expect(after.members).toHaveLength(0);
  });
});
