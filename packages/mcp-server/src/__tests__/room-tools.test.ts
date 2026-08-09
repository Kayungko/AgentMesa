import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace, addWorkspace, createMeeting, registerAgent } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaRoom, RoomMessage } from '@agentmesa/protocol';
import {
  handleCreateRoom,
  handleListRooms,
  handleInviteToRoom,
  handleSendRoomMessage,
  handleListRoomMessages,
  handleLeaveRoom,
} from '../tools.js';

let testDir: string;
let ctx: MesaRuntimeContext;
const prevHome = process.env['AGENTMESA_HOME'];
let homeDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-room-mcp-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-room-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
  // Register the workspace so label resolution can read it.
  addWorkspace({ rootDir: testDir, name: 'Test Workspace' });
});

afterEach(() => {
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
      kind: 'session',
      ref: 'meeting_1',
      label: '评审会',
    });

    const sent = JSON.parse(handleSendRoomMessage(ctx, {
      roomId: room.id,
      workspaceId: workspace.id,
      fromKind: 'session',
      fromRef: 'meeting_1',
      fromLabel: '评审会',
      summary: '跨 workspace 第一条',
    })) as RoomMessage;
    expect(sent.roomId).toBe(room.id);
    expect(sent.workspaceId).toBe(workspace.id);

    const listed = JSON.parse(handleListRoomMessages(ctx, { roomId: room.id })) as RoomMessage[];
    expect(listed).toHaveLength(1);
    expect(listed[0]!.summary).toBe('跨 workspace 第一条');
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
