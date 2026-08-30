import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  vi.useRealTimers();
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

  // --- M1: after 游标 / actorRef 校验 / 成员反查 ---

  it('filters messages by message-id cursor (after)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createRoomStore();
    const room = store.createRoom({ name: '游标群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });

    const m1 = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第一条',
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    const m2 = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第二条',
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
    const m3 = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第三条',
    });

    // 不带游标：全量。
    expect(store.listMessages(room.id)).toHaveLength(3);
    // 游标 = m2：只返回 m2 之后的消息。
    const afterM2 = store.listMessages(room.id, m2.id);
    expect(afterM2.map((m) => m.id)).toEqual([m3.id]);
    // 游标 = 最后一条：空。
    expect(store.listMessages(room.id, m3.id)).toEqual([]);
    // 游标 = m1：返回 m2、m3。
    expect(store.listMessages(room.id, m1.id).map((m) => m.id)).toEqual([m2.id, m3.id]);
  });

  it('falls back to createdAt comparison when the cursor is not a known message id', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createRoomStore();
    const room = store.createRoom({ name: '时间游标群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });

    store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第一条',
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    const m2 = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第二条',
    });

    // ISO 时间游标：返回严格晚于该时间的消息。
    const after = store.listMessages(room.id, '2026-01-01T00:00:00.000Z');
    expect(after.map((m) => m.id)).toEqual([m2.id]);
  });

  it('throws on an unrecognized cursor instead of silently returning empty', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '垃圾游标群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });
    store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '第一条',
    });

    // 非 id、非 ISO 时间戳的游标必须报错——静默返回空会让调用方以为读完了，
    // 且把游标重置到最新后永久丢失未读消息（与 listRoomEvents 策略一致）。
    expect(() => store.listMessages(room.id, 'msg_does_not_exist')).toThrow(
      /Unknown room message cursor/,
    );
  });

  it('rejects a senderRole outside the agent-role enum', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '角色白名单群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });

    // 非注册角色的 senderRole 不得入库（防止伪造 reviewer/admin 徽章）。
    expect(() => store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '伪造角色',
      senderRole: 'hacker',
    })).toThrow();

    // 枚举内角色正常入库。
    const sent = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '合法角色',
      senderRole: 'reviewer',
    });
    expect(sent.senderRole).toBe('reviewer');
  });

  it('rejects mentions that reference non-members', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: 'mention 校验群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'session', ref: 'meeting_1' });
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'claude' });

    // mentions 语义是 member refs：引用不在房间里的成员直接拒绝。
    expect(() => store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '@ghost 看下',
      mentions: ['claude', 'ghost'],
    })).toThrow(/non-members/);

    // 全部命中成员 ref 时正常入库。
    const sent = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'session', ref: 'meeting_1' },
      summary: '@claude 看下',
      mentions: ['claude'],
    });
    expect(sent.mentions).toEqual(['claude']);
  });

  it('rejects a sender whose ref does not match actorRef (impersonation)', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '防冒充群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'claude' });

    // actorRef 传入时，from.ref 必须相等——即便 from 本身是合法成员。
    expect(() => store.sendMessage(room.id, {
      workspaceId: wsB,
      from: { workspaceId: wsB, kind: 'agent', ref: 'claude' },
      summary: '冒充别人发言',
    }, { actorRef: 'codex' })).toThrow(/impersonation rejected/);

    // 匹配时正常发送。
    const sent = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'codex' },
      summary: '本人发言',
    }, { actorRef: 'codex' });
    expect(sent.summary).toBe('本人发言');
  });

  it('refreshes lastSeenAt on invite (idempotent) and on send', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createRoomStore();
    const room = store.createRoom({ name: '活跃群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });
    expect(store.getRoom(room.id).members[0]!.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');

    // 重复 invite：幂等，但刷新 lastSeenAt。
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    store.invite(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });
    expect(store.getRoom(room.id).members).toHaveLength(1);
    expect(store.getRoom(room.id).members[0]!.lastSeenAt).toBe('2026-01-01T00:00:05.000Z');

    // 发言也刷新发送者的 lastSeenAt。
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'codex' },
      summary: '说话',
    });
    expect(store.getRoom(room.id).members[0]!.lastSeenAt).toBe('2026-01-01T00:00:10.000Z');
  });

  it('lists rooms for a member with lastMessageAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createRoomStore();
    const roomA = store.createRoom({ name: '群 A' });
    const roomB = store.createRoom({ name: '群 B' });
    store.invite(roomA.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });
    store.invite(roomB.id, { workspaceId: wsB, kind: 'agent', ref: 'codex' });
    store.invite(roomA.id, { workspaceId: wsA, kind: 'agent', ref: 'claude' });

    vi.setSystemTime(new Date('2026-01-01T00:00:03.000Z'));
    store.sendMessage(roomA.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'claude' },
      summary: 'A 群的一条',
    });

    const mine = store.listRoomsForMember('codex');
    expect(mine.map((entry) => entry.room.id).sort()).toEqual([roomA.id, roomB.id].sort());
    const entryA = mine.find((entry) => entry.room.id === roomA.id)!;
    const entryB = mine.find((entry) => entry.room.id === roomB.id)!;
    expect(entryA.lastMessageAt).toBe('2026-01-01T00:00:03.000Z');
    expect(entryB.lastMessageAt).toBeNull(); // 无消息的房间

    // 非成员反查为空。
    expect(store.listRoomsForMember('unknown')).toEqual([]);
  });

  it('persists optional member and message enrichment fields', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '增强字段群' });
    store.invite(room.id, {
      workspaceId: wsA,
      kind: 'agent',
      ref: 'codex',
      roles: ['reviewer'],
      sessionRef: 'sess_123',
    });
    expect(store.getRoom(room.id).members[0]).toMatchObject({
      roles: ['reviewer'],
      sessionRef: 'sess_123',
    });
    // mentions 语义是 member refs：被 @ 的 claude 需先入群。
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'claude' });

    const message = store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'codex' },
      summary: '带增强字段的消息',
      mentions: ['claude'],
      senderRole: 'reviewer',
      origin: 'agent',
      body: '完整正文',
      taskId: 'task_1',
    });
    expect(message.mentions).toEqual(['claude']);
    expect(message.senderRole).toBe('reviewer');
    expect(message.origin).toBe('agent');
    expect(message.body).toBe('完整正文');
    expect(message.taskId).toBe('task_1');
  });

  // --- M1: 全局 Room 事件日志 ---

  it('appends room lifecycle events in order with snapshots', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '事件群', purpose: '审计回放' });
    store.invite(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex', label: 'Codex' });
    store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'codex', label: 'Codex' },
      summary: '第一条消息',
    });
    store.leave(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });

    const events = store.listRoomEvents(room.id);
    expect(events.map((event) => event.type)).toEqual([
      'room_created',
      'member_invited',
      'message_sent',
      'member_left',
    ]);
    // sequence 即行序号，从 0 连续递增。
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    // payload 携带对应快照。
    expect(events[0]!.payload['room']).toMatchObject({ id: room.id, name: '事件群' });
    expect(events[1]!.payload['member']).toMatchObject({ ref: 'codex', kind: 'agent' });
    expect(events[2]!.payload['message']).toMatchObject({ summary: '第一条消息', roomId: room.id });
    expect(events[3]!.payload['member']).toMatchObject({ ref: 'codex' });
  });

  it('stores the event log under <global>/rooms/events/<roomId>.jsonl', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '路径群' });
    const eventsFile = join(getGlobalMesaDir(), 'rooms', 'events', `${room.id}.jsonl`);
    expect(existsSync(eventsFile)).toBe(true);
    // JSONL：第一行即 room_created 事件。
    const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).type).toBe('room_created');
  });

  it('supports event-id and numeric-sequence cursors', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '游标事件群' });
    store.invite(room.id, { workspaceId: wsA, kind: 'agent', ref: 'codex' });
    store.invite(room.id, { workspaceId: wsB, kind: 'agent', ref: 'claude' });
    store.sendMessage(room.id, {
      workspaceId: wsA,
      from: { workspaceId: wsA, kind: 'agent', ref: 'codex' },
      summary: '说话',
    });

    const events = store.listRoomEvents(room.id);
    expect(events).toHaveLength(4);

    // 事件 id 游标：返回该事件之后的全部事件。
    const afterFirst = store.listRoomEvents(room.id, events[0]!.id);
    expect(afterFirst.map((event) => event.sequence)).toEqual([1, 2, 3]);
    // 游标 = 最后一条：空。
    expect(store.listRoomEvents(room.id, events[3]!.id)).toEqual([]);
    // 数字游标按行序号解释（after 行 0 → 从行 1 起）。
    expect(store.listRoomEvents(room.id, '0').map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(store.listRoomEvents(room.id, '2').map((event) => event.sequence)).toEqual([3]);
    // 未知游标报错——静默忽略会漏读。
    expect(() => store.listRoomEvents(room.id, 'not-a-cursor')).toThrow(/Unknown room event cursor/);
  });

  it('returns no events for unknown rooms and skips member_left no-ops', () => {
    const store = createRoomStore();
    expect(store.listRoomEvents('room_never_created')).toEqual([]);

    const room = store.createRoom({ name: '空退群' });
    // leave 一个不在房间里的成员：不追加 member_left 事件。
    store.leave(room.id, { workspaceId: wsA, kind: 'agent', ref: 'ghost' });
    expect(store.listRoomEvents(room.id).map((event) => event.type)).toEqual(['room_created']);
  });

  it('keeps the event log across deleteRoom (append-only audit trail)', () => {
    const store = createRoomStore();
    const room = store.createRoom({ name: '删除群' });
    store.deleteRoom(room.id);
    expect(() => store.getRoom(room.id)).toThrow(RoomNotFoundError);
    // 房间投影删除后事件日志保留——审计历史不随实体消失。
    expect(store.listRoomEvents(room.id).map((event) => event.type)).toEqual(['room_created']);
  });
});
