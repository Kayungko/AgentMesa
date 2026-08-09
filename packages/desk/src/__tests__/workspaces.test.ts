import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

let testDir: string;
let server: DeskServer;
let activated: string[] = [];
const prevHome = process.env['AGENTMESA_HOME'];
let homeDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-ws-'));
  initWorkspace(testDir);
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
  activated = [];
});

afterEach(async () => {
  if (server) await server.stop();
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

async function startServer() {
  server = new DeskServer(testDir, 0, {
    sessionToken: 'secret',
    onActivateWorkspace: async (ws) => { activated.push(ws.id); },
  });
  await server.start();
  return `http://127.0.0.1:${server.getPort()}`;
}

const auth = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

describe('DeskServer workspaces', () => {
  it('GET /api/workspaces returns the registry (empty initially)', async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/workspaces`, { headers: { Authorization: 'Bearer secret' } });
    const body = (await res.json()) as { workspaces: unknown[]; activeWorkspaceId?: string };
    expect(res.status).toBe(200);
    expect(body.workspaces).toEqual([]);
  });

  it('registers a workspace and lists it', async () => {
    const base = await startServer();
    const add = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ rootDir: testDir, name: 'Test Proj' }),
    });
    const added = (await add.json()) as { id: string; name: string };
    expect(add.status).toBe(201);
    expect(added.name).toBe('Test Proj');

    const list = await fetch(`${base}/api/workspaces`, { headers: { Authorization: 'Bearer secret' } });
    const body = (await list.json()) as { workspaces: Array<{ id: string }>; activeWorkspaceId?: string };
    expect(body.workspaces).toHaveLength(1);
    expect(body.activeWorkspaceId).toBe(added.id);
  });

  it('rejects registering an uninitialized directory', async () => {
    const base = await startServer();
    const uninit = mkdtempSync(join(tmpdir(), 'agentmesa-uninit-'));
    try {
      const res = await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ rootDir: uninit }),
      });
      expect(res.status).toBe(400);
    } finally {
      rmSync(uninit, { recursive: true, force: true });
    }
  });

  it('activate updates the registry and fires the hook', async () => {
    const base = await startServer();
    const add = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ rootDir: testDir }),
    });
    const added = (await add.json()) as { id: string };

    const activate = await fetch(`${base}/api/workspaces/${added.id}/activate`, {
      method: 'POST',
      headers: auth,
      body: '{}',
    });
    const body = (await activate.json()) as { id: string; switched: boolean };
    expect(activate.status).toBe(200);
    expect(body.switched).toBe(true);
    // The supervisor hook fires on a setImmediate after the response so the
    // request connection can close before the desk restarts (no deadlock).
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(activated).toContain(added.id);
  });

  it('removes a workspace', async () => {
    const base = await startServer();
    const add = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ rootDir: testDir }),
    });
    const added = (await add.json()) as { id: string };

    const del = await fetch(`${base}/api/workspaces/${added.id}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(del.status).toBe(200);

    const list = await fetch(`${base}/api/workspaces`, { headers: { Authorization: 'Bearer secret' } });
    const body = (await list.json()) as { workspaces: unknown[] };
    expect(body.workspaces).toEqual([]);
  });

  it('lists meetings of another workspace via cross-workspace read', async () => {
    const other = mkdtempSync(join(tmpdir(), 'agentmesa-other-'));
    initWorkspace(other);
    const base = await startServer();

    const add = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ rootDir: other }),
    });
    const added = (await add.json()) as { id: string };

    const res = await fetch(`${base}/api/workspaces/${added.id}/meetings`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    const agents = await fetch(`${base}/api/workspaces/${added.id}/agents`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(agents.status).toBe(200);
    expect(await agents.json()).toEqual([]);

    rmSync(other, { recursive: true, force: true });
  });
});
