import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

let testDir: string;
let server: DeskServer;
const prevHome = process.env['AGENTMESA_HOME'];
let homeDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-room-'));
  initWorkspace(testDir);
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-room-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(async () => {
  if (server) await server.stop();
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

async function startServer() {
  server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
  await server.start();
  return `http://127.0.0.1:${server.getPort()}`;
}

const auth = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

describe('DeskServer rooms', () => {
  it('creates and lists rooms', async () => {
    const base = await startServer();
    const created = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '跨项目评审群' }),
    });
    const room = (await created.json()) as { id: string; name: string };
    expect(created.status).toBe(201);
    expect(room.name).toBe('跨项目评审群');

    const list = await fetch(`${base}/api/rooms`, { headers: { Authorization: 'Bearer secret' } });
    const rooms = (await list.json()) as Array<{ id: string }>;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.id).toBe(room.id);
  });

  it('creates a room with a purpose anchor', async () => {
    const base = await startServer();
    const created = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '评审群', purpose: '评审 7 月版登录重构' }),
    });
    const room = (await created.json()) as { id: string; purpose?: string };
    expect(created.status).toBe(201);
    expect(room.purpose).toBe('评审 7 月版登录重构');
  });

  it('invites a member and reads room detail with messages', async () => {
    const base = await startServer();
    const room = (await (await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '群' }),
    })).json()) as { id: string };

    const invite = await fetch(`${base}/api/rooms/${room.id}/members`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        workspaceId: 'ws_1',
        kind: 'session',
        ref: 'meeting_1',
        label: '评审会',
      }),
    });
    const invited = (await invite.json()) as { members: unknown[] };
    expect(invited.members).toHaveLength(1);

    const msg = await fetch(`${base}/api/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        workspaceId: 'ws_1',
        from: { workspaceId: 'ws_1', kind: 'session', ref: 'meeting_1', label: '评审会' },
        summary: '跨 workspace 消息',
      }),
    });
    expect(msg.status).toBe(201);

    const detail = await fetch(`${base}/api/rooms/${room.id}`, { headers: { Authorization: 'Bearer secret' } });
    const body = (await detail.json()) as { messages: Array<{ summary: string }>; members: unknown[]; totalMessages?: number };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.summary).toBe('跨 workspace 消息');
    expect(body.totalMessages).toBe(1);
    expect(body.members).toHaveLength(1);
  });

  it('rejects creating a room without a name', async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('enriches room list with the latest message preview', async () => {
    const base = await startServer();
    const room = (await (await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '预览群' }),
    })).json()) as { id: string };

    await fetch(`${base}/api/rooms/${room.id}/members`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ workspaceId: 'ws_1', kind: 'human', ref: 'user', label: '我' }),
    });
    await fetch(`${base}/api/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        workspaceId: 'ws_1',
        from: { workspaceId: 'ws_1', kind: 'human', ref: 'user', label: '我' },
        summary: '最后一条预览',
      }),
    });

    const list = await fetch(`${base}/api/rooms`, { headers: { Authorization: 'Bearer secret' } });
    const rooms = (await list.json()) as Array<{ id: string; lastMessagePreview?: string; lastMessageId?: string }>;
    const found = rooms.find((entry) => entry.id === room.id);
    expect(found?.lastMessagePreview).toBe('最后一条预览');
    expect(found?.lastMessageId).toBeTruthy();
  });

  it('serves the room event stream endpoint (token-gated)', async () => {
    const base = await startServer();
    const stream = await fetch(`${base}/api/rooms/events/stream?access_token=secret`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    // Read the initial retry frame then drop the connection.
    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('retry:');
    await reader.cancel();

    // 无 token → 401
    const denied = await fetch(`${base}/api/rooms/events/stream`);
    expect(denied.status).toBe(401);
  });
});
