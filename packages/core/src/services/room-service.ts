import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  currentProtocolVersion,
  generateRoomId,
  generateMessageId,
  generateEventId,
  MesaRoomSchema,
  RoomMessageSchema,
  CreateRoomInputSchema,
  SendRoomMessageInputSchema,
} from '@agentmesa/protocol';
import type { MesaRoom, RoomMember, RoomMemberInput, RoomMessage } from '@agentmesa/protocol';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import type { MesaRuntimeContext, MesaStorageAdapter } from '../runtime/types.js';
import { MesaError } from '../errors.js';
import { getGlobalMesaDir } from '../workspace-registry.js';
import { withLock } from './lock-manager.js';

/**
 * Global Room store — cross-workspace group chat. A room gathers sessions and
 * agents from different workspaces (identified by the `(workspaceId, kind, ref)`
 * triple) so their messages flow together. Like the workspace registry, room
 * data lives in the global mesa home, NOT inside any single project's
 * `.agentmesa/`.
 */
export function roomStoreDir(baseDir: string = getGlobalMesaDir()): string {
  return join(baseDir, 'rooms');
}

function roomFilePath(baseDir: string, roomId: string): string {
  return join(roomStoreDir(baseDir), `${roomId}.json`);
}

function roomMessagesDir(baseDir: string, roomId: string): string {
  return join(roomStoreDir(baseDir), 'messages', roomId);
}

/** Error thrown when a room does not exist. */
export class RoomNotFoundError extends MesaError {
  constructor(roomId: string) {
    super('ROOM_NOT_FOUND', `Room not found: ${roomId}`);
    this.name = 'RoomNotFoundError';
  }
}

function readRoom(storage: MesaStorageAdapter, baseDir: string, roomId: string): MesaRoom {
  const raw = storage.readText(roomFilePath(baseDir, roomId));
  if (raw === null) {
    throw new RoomNotFoundError(roomId);
  }
  return MesaRoomSchema.parse(JSON.parse(raw) as unknown);
}

function listAllRooms(storage: MesaStorageAdapter, baseDir: string): MesaRoom[] {
  return storage
    .list(roomStoreDir(baseDir))
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const raw = storage.readText(join(roomStoreDir(baseDir), name));
      if (raw === null) return null;
      try {
        return MesaRoomSchema.parse(JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    })
    .filter((room): room is MesaRoom => room !== null);
}

function readMessage(storage: MesaStorageAdapter, dir: string, name: string): RoomMessage | null {
  const raw = storage.readText(join(dir, name));
  if (raw === null) return null;
  try {
    return RoomMessageSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** 按成员三元组生成去重 key。 */
function memberKey(member: Pick<RoomMember, 'workspaceId' | 'kind' | 'ref'>): string {
  return `${member.workspaceId}|${member.kind}|${member.ref}`;
}

/**
 * 仅供锁管理器使用的最小 context 形状：lock-manager 只读取 `paths.locksDir`
 * 与 `storage`，其余成员用不到。锁文件落在 `<global mesa home>/rooms/locks/`
 * 下，与 workspace 级锁目录隔离。
 */
interface RoomLockContext {
  paths: { locksDir: string };
  storage: MesaStorageAdapter;
}

function roomLockContext(baseDir: string, storage: MesaStorageAdapter): RoomLockContext {
  return { paths: { locksDir: join(roomStoreDir(baseDir), 'locks') }, storage };
}

/** 成员按 ref 匹配（忽略 workspace/kind），供按成员反查房间使用。 */
function hasMemberRef(room: MesaRoom, ref: string): boolean {
  return room.members.some((member) => member.ref === ref);
}

// --- Room 事件日志（全局，跨工作区） ---
//
// Room 是跨工作区实体，事件归属全局 mesa home 而不是任何 per-workspace 的
// `.agentmesa/events/`（见 DOMAIN_MODEL.md「Room 住全局目录」）。每个房间一份
// append-only 的 JSONL 日志：<global>/rooms/events/<roomId>.jsonl。事件与房间
// 投影 JSON 在同一把 room 锁内同步写：事件先追加、投影后写 —— 事件是审计事实，
// 投影写失败可由事件重建；反过来则可能出现"投影存在但历史缺失"。

/** Room 事件类型（M1 起冻结，append-only 日志不可改名）。 */
export type RoomEventType =
  | 'room_created'
  | 'member_invited'
  | 'member_left'
  | 'message_sent';

export interface RoomEvent {
  /** 事件 id（`event_*`），增量读取的主游标。 */
  id: string;
  /** 0 起始的行序号，可作数值游标使用。 */
  sequence: number;
  roomId: string;
  type: RoomEventType;
  /** 事件快照：房间 / 成员 / 消息。 */
  payload: Record<string, unknown>;
  timestamp: string;
}

function roomEventsDir(baseDir: string): string {
  return join(roomStoreDir(baseDir), 'events');
}

function roomEventsFilePath(baseDir: string, roomId: string): string {
  return join(roomEventsDir(baseDir), `${roomId}.jsonl`);
}

function readRoomEvents(storage: MesaStorageAdapter, baseDir: string, roomId: string): RoomEvent[] {
  const raw = storage.readText(roomEventsFilePath(baseDir, roomId));
  if (raw === null) {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      try {
        return JSON.parse(line) as RoomEvent;
      } catch {
        throw new MesaError(
          'STORAGE_ERROR',
          `Corrupted room event line in ${roomEventsFilePath(baseDir, roomId)}: ${line.slice(0, 120)}`,
        );
      }
    });
}

/**
 * 追加一条 room 事件。必须在 room 锁内调用（或针对新建房间——新 id 无争用）：
 * sequence 由当前日志长度推导，锁保证并发下不重复。
 *
 * 追加走 node:fs 而非 storage adapter——adapter 只有整文件原子写，没有 append
 * 语义（与 FileEventStore 的做法一致）；读取仍走 adapter 以便测试注入。
 */
function appendRoomEvent(
  storage: MesaStorageAdapter,
  baseDir: string,
  roomId: string,
  type: RoomEventType,
  payload: Record<string, unknown>,
): RoomEvent {
  const events = readRoomEvents(storage, baseDir, roomId);
  const event: RoomEvent = {
    id: generateEventId(),
    sequence: events.length,
    roomId,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
  mkdirSync(roomEventsDir(baseDir), { recursive: true });
  appendFileSync(roomEventsFilePath(baseDir, roomId), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function createRoomStore(
  baseDir: string = getGlobalMesaDir(),
  storage: MesaStorageAdapter = new FileStorageAdapter(),
) {
  return {
    listRooms(): MesaRoom[] {
      return listAllRooms(storage, baseDir);
    },

    getRoom(roomId: string): MesaRoom {
      return readRoom(storage, baseDir, roomId);
    },

    createRoom(input: { name: string; purpose?: string }): MesaRoom {
      const validated = CreateRoomInputSchema.parse(input);
      const now = new Date().toISOString();
      const room: MesaRoom = MesaRoomSchema.parse({
        protocolVersion: currentProtocolVersion,
        id: generateRoomId(),
        name: validated.name.trim(),
        ...(validated.purpose?.trim() ? { purpose: validated.purpose.trim() } : {}),
        members: [],
        createdAt: now,
        updatedAt: now,
      });
      // 事件先追加、投影后写（新房间 id 无锁争用，事件与投影天然顺序一致）。
      appendRoomEvent(storage, baseDir, room.id, 'room_created', { room });
      storage.writeText(roomFilePath(baseDir, room.id), `${JSON.stringify(room, null, 2)}\n`);
      return room;
    },

    invite(roomId: string, member: RoomMemberInput): MesaRoom {
      // 读-改-写整体持锁，避免并发 invite 丢更新。
      return withLock(roomLockContext(baseDir, storage) as unknown as MesaRuntimeContext, `room:${roomId}`, () => {
        const room = readRoom(storage, baseDir, roomId);
        const key = memberKey(member);
        const now = new Date().toISOString();
        const existing = room.members.find(
          (candidate) => memberKey(candidate) === key,
        );
        const updated: MesaRoom = existing
          ? {
              // 幂等 invite：成员已存在时刷新 lastSeenAt（并补齐新传入的元数据）。
              ...room,
              members: room.members.map((candidate) =>
                candidate === existing
                  ? {
                      ...candidate,
                      lastSeenAt: now,
                      ...(member.label ? { label: member.label } : {}),
                      ...(member.roles ? { roles: member.roles } : {}),
                      ...(member.sessionRef ? { sessionRef: member.sessionRef } : {}),
                    }
                  : candidate,
              ),
              updatedAt: now,
            }
          : {
              ...room,
              members: [
                ...room.members,
                {
                  ...member,
                  joinedAt: now,
                  lastSeenAt: now,
                } satisfies RoomMember,
              ],
              updatedAt: now,
            };
        const result = MesaRoomSchema.parse(updated);
        // 事件先追加、投影后写（锁内）。幂等 invite 也会记录——成员快照刷新
        // 同样是一次事实性的成员变更。
        const invitedMember = result.members.find((candidate) => memberKey(candidate) === key);
        appendRoomEvent(storage, baseDir, roomId, 'member_invited', { member: invitedMember });
        storage.writeText(roomFilePath(baseDir, roomId), `${JSON.stringify(result, null, 2)}\n`);
        return result;
      });
    },

    leave(roomId: string, member: RoomMemberInput): MesaRoom {
      const lockCtx = roomLockContext(baseDir, storage);
      return withLock(lockCtx as unknown as MesaRuntimeContext, `room:${roomId}`, () => {
        const room = readRoom(storage, baseDir, roomId);
        const key = memberKey(member);
        const removed = room.members.find((existing) => memberKey(existing) === key);
        const next = room.members.filter((existing) => memberKey(existing) !== key);
        const updated: MesaRoom = {
          ...room,
          members: next,
          updatedAt: new Date().toISOString(),
        };
        const result = MesaRoomSchema.parse(updated);
        // 成员确实离开才记事件——对不在房间里的成员调 leave 不产生历史噪音。
        if (removed) {
          appendRoomEvent(storage, baseDir, roomId, 'member_left', { member: removed });
        }
        storage.writeText(roomFilePath(baseDir, roomId), `${JSON.stringify(result, null, 2)}\n`);
        return result;
      });
    },

    deleteRoom(roomId: string): void {
      storage.delete(roomFilePath(baseDir, roomId));
    },

    sendMessage(roomId: string, input: unknown, options?: { actorRef?: string }): RoomMessage {
      const validated = SendRoomMessageInputSchema.parse(input);
      // 防冒充：调用方（如 MCP handler）传入 actorRef 时，from.ref 必须与
      // 实际 actor 一致，不允许以其他成员身份发言。
      if (options?.actorRef !== undefined && validated.from.ref !== options.actorRef) {
        throw new MesaError(
          'VALIDATION_ERROR',
          `Sender ref "${validated.from.ref}" does not match the actor "${options.actorRef}" — impersonation rejected.`,
        );
      }
      const lockCtx = roomLockContext(baseDir, storage);
      return withLock(lockCtx as unknown as MesaRuntimeContext, `room:${roomId}`, () => {
        // The room must exist to post into it.
        const room = readRoom(storage, baseDir, roomId);
        // Only room members may speak — prevents identity spoofing (a sender
        // posing as a session/agent that is not actually in the group).
        const fromKey = memberKey(validated.from);
        const isMember = room.members.some((member) => memberKey(member) === fromKey);
        if (!isMember) {
          throw new MesaError(
            'VALIDATION_ERROR',
            `Sender is not a member of room ${roomId}: ${fromKey}. Invite the member first.`,
          );
        }
        const now = new Date().toISOString();
        const message: RoomMessage = RoomMessageSchema.parse({
          protocolVersion: currentProtocolVersion,
          id: generateMessageId(),
          roomId,
          workspaceId: validated.workspaceId,
          from: validated.from,
          type: validated.type ?? 'general',
          summary: validated.summary,
          ...(validated.mentions ? { mentions: validated.mentions } : {}),
          ...(validated.senderRole ? { senderRole: validated.senderRole } : {}),
          ...(validated.origin ? { origin: validated.origin } : {}),
          ...(validated.body ? { body: validated.body } : {}),
          ...(validated.taskId ? { taskId: validated.taskId } : {}),
          createdAt: now,
        });
        // 发言即活跃：刷新发送者的 lastSeenAt。
        const updatedRoom: MesaRoom = MesaRoomSchema.parse({
          ...room,
          members: room.members.map((member) =>
            memberKey(member) === fromKey ? { ...member, lastSeenAt: now } : member,
          ),
          updatedAt: now,
        });
        // 事件先追加、投影后写（锁内）。
        appendRoomEvent(storage, baseDir, roomId, 'message_sent', { message });
        storage.writeText(roomFilePath(baseDir, roomId), `${JSON.stringify(updatedRoom, null, 2)}\n`);
        const dir = roomMessagesDir(baseDir, roomId);
        storage.ensureDirectory(dir);
        storage.writeText(join(dir, `${message.id}.json`), `${JSON.stringify(message, null, 2)}\n`);
        return message;
      });
    },

    listMessages(roomId: string, after?: string): RoomMessage[] {
      const dir = roomMessagesDir(baseDir, roomId);
      if (!storage.exists(dir)) {
        return [];
      }
      const messages = storage
        .list(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readMessage(storage, dir, name))
        .filter((message): message is RoomMessage => message !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (after === undefined) {
        return messages;
      }
      // 首选按消息 id 游标（精确、稳定）；游标不是已知消息 id 时退化为
      // ISO 时间比较（至少一次语义，同毫秒消息可能重复投递）。
      const index = messages.findIndex((message) => message.id === after);
      if (index !== -1) {
        return messages.slice(index + 1);
      }
      return messages.filter((message) => message.createdAt.localeCompare(after) > 0);
    },

    /**
     * 读取 room 事件日志，支持游标增量读取。游标优先匹配事件 id；纯数字游标
     * 按行序号（sequence）解释；其余游标抛错——静默忽略会漏读，宁可报错。
     * 房间不存在或尚无事件时返回空数组。
     */
    listRoomEvents(roomId: string, after?: string): RoomEvent[] {
      const events = readRoomEvents(storage, baseDir, roomId);
      if (after === undefined) {
        return events;
      }
      const index = events.findIndex((event) => event.id === after);
      if (index !== -1) {
        return events.slice(index + 1);
      }
      if (/^\d+$/.test(after)) {
        return events.filter((event) => event.sequence > Number(after));
      }
      throw new MesaError('VALIDATION_ERROR', `Unknown room event cursor: ${after}`);
    },

    /**
     * 按成员 ref 反查其加入的所有房间，附带每个房间最后一条消息的时间，
     * 供 mesa_poll_rooms 增量轮询使用。
     */
    listRoomsForMember(ref: string): Array<{ room: MesaRoom; lastMessageAt: string | null }> {
      return listAllRooms(storage, baseDir)
        .filter((room) => hasMemberRef(room, ref))
        .map((room) => {
          const messages = this.listMessages(room.id);
          return { room, lastMessageAt: messages.at(-1)?.createdAt ?? null };
        });
    },
  };
}
