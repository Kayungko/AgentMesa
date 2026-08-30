import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import type { DriverPermissionRequest } from '@agentmesa/runner';
import { DeskServer } from '../server.js';
import {
  PermissionApprovalQueue,
  createDeskAskHuman,
  type PendingPermissionApproval,
} from '../permission-approvals.js';

function request(input: Partial<DriverPermissionRequest> = {}): DriverPermissionRequest {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    kind: 'command',
    title: 'bash: rm -rf build/',
    detail: { command: 'rm -rf build/' },
    ...input,
  };
}

let testDir: string;
let server: DeskServer;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-perm-'));
  initWorkspace(testDir);
});

afterEach(async () => {
  if (server) {
    await server.stop();
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe('PermissionApprovalQueue', () => {
  it('enqueues a pending approval and decides allow', async () => {
    const queue = new PermissionApprovalQueue();
    const promise = queue.enqueue(request(), { meetingId: 'meet-1' });
    const pending = queue.list();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'command',
      title: 'bash: rm -rf build/',
      resource: 'rm -rf build/',
      meetingId: 'meet-1',
    });
    expect(typeof pending[0]!.requestedAt).toBe('string');

    expect(queue.decide(pending[0]!.id, 'allow')).toBe(true);
    await expect(promise).resolves.toBe('allow');
    expect(queue.list()).toEqual([]);
  });

  it('decides deny and resolves the promise with deny', async () => {
    const queue = new PermissionApprovalQueue();
    const req = request({ requestId: 'req_deny' });
    const promise = queue.enqueue(req);

    expect(queue.decide('req_deny', 'deny')).toBe(true);
    await expect(promise).resolves.toBe('deny');
  });

  it('auto-denies and dequeues after timeoutMs elapses', async () => {
    const queue = new PermissionApprovalQueue();
    const promise = queue.enqueue(request(), { timeoutMs: 20 });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(promise).resolves.toBe('deny');
    expect(queue.list()).toEqual([]);
  });

  it('clear() denies every pending approval', async () => {
    const queue = new PermissionApprovalQueue();
    const first = queue.enqueue(request(), { timeoutMs: 5_000 });
    const second = queue.enqueue(request(), { timeoutMs: 5_000 });

    queue.clear();

    await expect(first).resolves.toBe('deny');
    await expect(second).resolves.toBe('deny');
    expect(queue.list()).toEqual([]);
  });

  it('returns false for an unknown (or already decided) id', async () => {
    const queue = new PermissionApprovalQueue();
    expect(queue.decide('nope', 'allow')).toBe(false);

    const req = request({ requestId: 'req_once' });
    const promise = queue.enqueue(req);
    queue.decide('req_once', 'deny');
    await expect(promise).resolves.toBe('deny');
    expect(queue.decide('req_once', 'allow')).toBe(false);
  });

  it('fail-closes a duplicate requestId before queueing the new entry', async () => {
    const queue = new PermissionApprovalQueue();
    const first = queue.enqueue(request({ requestId: 'req_dup' }), { timeoutMs: 5_000 });
    const second = queue.enqueue(request({ requestId: 'req_dup' }), { timeoutMs: 5_000 });

    await expect(first).resolves.toBe('deny');
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_dup', 'allow');
    await expect(second).resolves.toBe('allow');
  });

  it('extracts resources defensively from unknown detail shapes', () => {
    const queue = new PermissionApprovalQueue();
    const cases: Array<[DriverPermissionRequest['kind'], unknown, string | undefined]> = [
      ['patch', { changes: [{ path: 'a.ts' }, { path: 'b.ts' }] }, 'a.ts, b.ts'],
      ['tool', { tool_name: 'Write', input: { file_path: 'x' } }, 'Write'],
      ['tool', 'plain string detail', 'plain string detail'],
      ['tool', 42, undefined],
      ['tool', null, undefined],
    ];
    for (const [kind, detail] of cases) {
      queue.enqueue(request({ kind, detail }), { timeoutMs: 5_000 });
    }
    const resources = queue.list().map((entry: PendingPermissionApproval) => entry.resource);
    expect(resources[0]).toBe('a.ts, b.ts');
    expect(resources[1]).toBe('Write');
    expect(resources[2]).toBe('plain string detail');
    expect(resources[3]).toBeUndefined();
    expect(resources[4]).toBeUndefined();
    queue.clear();
  });
});

describe('createDeskAskHuman', () => {
  it('returns an askHuman bound to the queue with closure meetingId/timeout', async () => {
    const queue = new PermissionApprovalQueue();
    const askHuman = createDeskAskHuman(queue, { meetingId: 'meet-9', timeoutMs: 5_000 });

    const promise = askHuman(request({ requestId: 'req_gate' }));
    expect(queue.list()[0]).toMatchObject({ id: 'req_gate', meetingId: 'meet-9' });

    queue.decide('req_gate', 'allow');
    await expect(promise).resolves.toBe('allow');
  });
});

describe('DeskServer permission approval API', () => {
  it('GET /api/permissions/pending lists enqueued approvals', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const askHuman = createDeskAskHuman(server.permissionApprovals, { meetingId: 'meet-1', timeoutMs: 5_000 });
    askHuman(request({ requestId: 'req_api_1' }));

    const base = `http://localhost:${server.getPort()}`;
    const headers = { Authorization: 'Bearer secret' };

    const res = await fetch(`${base}/api/permissions/pending`, { headers });
    const body = (await res.json()) as { pending: PendingPermissionApproval[] };

    expect(res.status).toBe(200);
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({ id: 'req_api_1', kind: 'command', meetingId: 'meet-1' });
  });

  it('POST /api/permissions/:id/decide resolves the askHuman promise', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const askHuman = createDeskAskHuman(server.permissionApprovals, { timeoutMs: 5_000 });
    const promise = askHuman(request({ requestId: 'req_api_decide' }));

    const base = `http://localhost:${server.getPort()}`;
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

    const res = await fetch(`${base}/api/permissions/req_api_decide/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(promise).resolves.toBe('allow');

    const pending = (await (await fetch(`${base}/api/permissions/pending`, { headers })).json()) as { pending: unknown[] };
    expect(pending.pending).toEqual([]);
  });

  it('returns 404 for an unknown permission id and 400 for a bad decision', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const base = `http://localhost:${server.getPort()}`;
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

    const missing = await fetch(`${base}/api/permissions/ghost/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow' }),
    });
    expect(missing.status).toBe(404);

    const invalid = await fetch(`${base}/api/permissions/anything/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('requires the session token like every other API route', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const base = `http://localhost:${server.getPort()}`;

    expect((await fetch(`${base}/api/permissions/pending`)).status).toBe(401);
    expect((await fetch(`${base}/api/permissions/x/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    })).status).toBe(401);
  });

  it('stop() denies approvals still pending', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const askHuman = createDeskAskHuman(server.permissionApprovals, { timeoutMs: 30_000 });
    const promise = askHuman(request({ requestId: 'req_stop' }));

    await server.stop();
    await expect(promise).resolves.toBe('deny');
  });
});
