import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRoomStore, roomStoreDir, RoomNotFoundError } from '../services/room-service.js';
import { getGlobalMesaDir } from '../workspace-registry.js';

let homeDir: string;
const prevHome = process.env['AGENTMESA_HOME'];

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-room-'));
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(homeDir, { recursive: true, force: true });
});

const wsA = 'ws_a';
const wsB = 'ws_b';

describe('room service', () => {
  it('resolves room store dir under the global mesa home', () => {
    expect(roomStoreDir()).toBe(join(getGlobalMesaDir(), 'rooms'));
  });

  it('creates and lists rooms', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '跨项目评审群' });
    expect(room.id).toMatch(/^room_/);
    expect(room.name).toBe('跨项目评审群');
    expect(room.members).toEqual([]);

    const rooms = store.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.id).toBe(room.id);
  });

  it('creates a room with an optional purpose anchor', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '评审群', purpose: '评审 7 月版登录重构' });
    expect(room.purpose).toBe('评审 7 月版登录重构');

    // purpose 可选：缺省时不携带该字段
    const bare = store.createRoom({ name: '无锚点群' });
    expect(bare.purpose).toBeUndefined();
  });

  it('invites members idempotently', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });

    const afterFirst = store.invite(room.id, {
      workspaceId: wsA,
      kind: 'session',
      ref: 'meeting_1',
      label: 'Idel-Game 评审会',
    });
    expect(afterFirst.members).toHaveLength(1);
    expect(afterFirst.members[0]).toMatchObject({ workspaceId: wsA, kind: 'session', ref: 'meeting_1' });

    // Duplicate invite is a no-op.
    const afterDup = store.invite(room.id, {
      workspaceId: wsA,
      kind: 'session',
      ref: 'meeting_1',
    });
    expect(afterDup.members).toHaveLength(1);
  });

  it('supports sessions and agents as members', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1', label: '评审会' });
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'codex', label: 'Codex (reviewer)' });
    const final = store.getRoom(room.id);
    expect(final.members).toHaveLength(2);
  });

  it('leaves a room', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });
    const after = store.leave(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });
    expect(after.members).toHaveLength(0);
  });

  it('throws on unknown room', () => {
    const store = createRoomStore();
    expect(() => store.getRoom('room_missing')).toThrow(RoomNotFoundError);
  });

  it('aggregates messages across workspaces in time order', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '跨项目群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1', label: '评审会' });
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'codex', label: 'Codex' });

    const m1 = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1', label: '评审会' },
      summary: 'A 发的第一条',
    });
    const m2 = store.sendMessage(room.id, {
      workspaceId: wsB,
      from: { workspaceId: wsB, kind: 'agent', ref: 'codex', label: 'Codex' },
      summary: 'B 发的第二条',
    });

    const messages = store.listMessages(room.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.workspaceId).toBe(wsA);
    expect(messages[1]!.workspaceId).toBe(wsB);
    expect(messages.map((m) => m.summary)).toEqual(['A 发的第一条', 'B 发的第二条']);
    expect(messages[0]!.id).toBe(m1.id);
    expect(messages[1]!.id).toBe(m2.id);
  });

  it('rejects a non-member sender (identity spoofing)', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });

    // A session that was never invited cannot speak.
    expect(() => store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_999', label: '假身份' },
      summary: '身份伪造',
    })).toThrow(/not a member/);
  });

  it('deleteRoom removes the room', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '群' });
    store.deleteRoom(room.id);
    expect(store.listRooms()).toHaveLength(0);
    expect(() => store.getRoom(room.id)).toThrow(RoomNotFoundError);
  });
});
