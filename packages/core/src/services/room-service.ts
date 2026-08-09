import { join } from 'node:path';
import {
  currentProtocolVersion,
  generateRoomId,
  generateMessageId,
  MesaRoomSchema,
  RoomMessageSchema,
  CreateRoomInputSchema,
  SendRoomMessageInputSchema,
} from '@agentmesa/protocol';
import type { MesaRoom, RoomMember, RoomMemberInput, RoomMessage } from '@agentmesa/protocol';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import type { MesaStorageAdapter } from '../runtime/types.js';
import { MesaError } from '../errors.js';
import { getGlobalMesaDir } from '../workspace-registry.js';

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

function readMessage(storage: MesaStorageAdapter, dir: string, name: string): RoomMessage | null {
  const raw = storage.readText(join(dir, name));
  if (raw === null) return null;
  try {
    return RoomMessageSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function createRoomStore(
  baseDir: string = getGlobalMesaDir(),
  storage: MesaStorageAdapter = new FileStorageAdapter(),
) {
  return {
    listRooms(): MesaRoom[] {
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
      storage.writeText(roomFilePath(baseDir, room.id), `${JSON.stringify(room, null, 2)}\n`);
      return room;
    },

    invite(roomId: string, member: RoomMemberInput): MesaRoom {
      const room = readRoom(storage, baseDir, roomId);
      const key = `${member.workspaceId}|${member.kind}|${member.ref}`;
      if (room.members.some((existing) => `${existing.workspaceId}|${existing.kind}|${existing.ref}` === key)) {
        return room; // idempotent
      }
      const joined: RoomMember = {
        ...member,
        joinedAt: new Date().toISOString(),
      };
      const updated: MesaRoom = {
        ...room,
        members: [...room.members, joined],
        updatedAt: new Date().toISOString(),
      };
      const result = MesaRoomSchema.parse(updated);
      storage.writeText(roomFilePath(baseDir, roomId), `${JSON.stringify(result, null, 2)}\n`);
      return result;
    },

    leave(roomId: string, member: RoomMemberInput): MesaRoom {
      const room = readRoom(storage, baseDir, roomId);
      const key = `${member.workspaceId}|${member.kind}|${member.ref}`;
      const next = room.members.filter(
        (existing) => `${existing.workspaceId}|${existing.kind}|${existing.ref}` !== key,
      );
      const updated: MesaRoom = {
        ...room,
        members: next,
        updatedAt: new Date().toISOString(),
      };
      const result = MesaRoomSchema.parse(updated);
      storage.writeText(roomFilePath(baseDir, roomId), `${JSON.stringify(result, null, 2)}\n`);
      return result;
    },

    deleteRoom(roomId: string): void {
      storage.delete(roomFilePath(baseDir, roomId));
    },

    sendMessage(roomId: string, input: unknown): RoomMessage {
      const validated = SendRoomMessageInputSchema.parse(input);
      // The room must exist to post into it.
      const room = readRoom(storage, baseDir, roomId);
      // Only room members may speak — prevents identity spoofing (a sender
      // posing as a session/agent that is not actually in the group).
      const fromKey = `${validated.from.workspaceId}|${validated.from.kind}|${validated.from.ref}`;
      const isMember = room.members.some(
        (member) => `${member.workspaceId}|${member.kind}|${member.ref}` === fromKey,
      );
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
        createdAt: now,
      });
      const dir = roomMessagesDir(baseDir, roomId);
      storage.ensureDirectory(dir);
      storage.writeText(join(dir, `${message.id}.json`), `${JSON.stringify(message, null, 2)}\n`);
      return message;
    },

    listMessages(roomId: string): RoomMessage[] {
      const dir = roomMessagesDir(baseDir, roomId);
      if (!storage.exists(dir)) {
        return [];
      }
      return storage
        .list(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readMessage(storage, dir, name))
        .filter((message): message is RoomMessage => message !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}
