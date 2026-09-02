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

  it('allow_session grants auto-approve the same (meeting, kind) without queueing', async () => {
    const grantHits: Array<{ meetingId: string; kind: string; requestId: string }> = [];
    const queue = new PermissionApprovalQueue({
      onGrantHit: (info) => grantHits.push(info),
    });
    // First request: queued, decided allow_session.
    const first = queue.enqueue(request({ requestId: 'req_s1', kind: 'tool' }), { meetingId: 'meet-grant', timeoutMs: 5_000 });
    queue.decide('req_s1', 'allow_session');
    await expect(first).resolves.toBe('allow');

    // Second request of the same kind + meeting: short-circuits the queue —
    // no entry, no 5-minute timer, resolves allow immediately.
    const second = queue.enqueue(request({ requestId: 'req_s2', kind: 'tool' }), { meetingId: 'meet-grant', timeoutMs: 20 });
    await expect(second).resolves.toBe('allow');
    expect(queue.list()).toEqual([]);
    expect(grantHits).toHaveLength(1);
    expect(grantHits[0]).toMatchObject({ meetingId: 'meet-grant', kind: 'tool', requestId: 'req_s2' });
  });

  it('session grants are keyed by (meetingId, kind) and skip nothing else', async () => {
    const queue = new PermissionApprovalQueue();
    const first = queue.enqueue(request({ requestId: 'req_k1', kind: 'tool' }), { meetingId: 'meet-a', timeoutMs: 5_000 });
    queue.decide('req_k1', 'allow_session');
    await expect(first).resolves.toBe('allow');

    // Different meeting: still queued normally.
    const otherMeeting = queue.enqueue(request({ requestId: 'req_k2', kind: 'tool' }), { meetingId: 'meet-b', timeoutMs: 5_000 });
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_k2', 'deny');
    await expect(otherMeeting).resolves.toBe('deny');

    // Same meeting, different kind: still queued normally.
    const otherKind = queue.enqueue(request({ requestId: 'req_k3', kind: 'command' }), { meetingId: 'meet-a', timeoutMs: 5_000 });
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_k3', 'deny');
    await expect(otherKind).resolves.toBe('deny');
  });

  it('plain allow and deny do not create session grants', async () => {
    const queue = new PermissionApprovalQueue();
    const allowed = queue.enqueue(request({ requestId: 'req_p1' }), { meetingId: 'meet-plain', timeoutMs: 5_000 });
    queue.decide('req_p1', 'allow');
    await expect(allowed).resolves.toBe('allow');

    const denied = queue.enqueue(request({ requestId: 'req_p2' }), { meetingId: 'meet-plain', timeoutMs: 5_000 });
    queue.decide('req_p2', 'deny');
    await expect(denied).resolves.toBe('deny');

    // No grant recorded: the next request still queues.
    const next = queue.enqueue(request({ requestId: 'req_p3' }), { meetingId: 'meet-plain', timeoutMs: 5_000 });
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_p3', 'deny');
    await expect(next).resolves.toBe('deny');
  });

  it('clear() revokes session grants along with pending entries', async () => {
    const queue = new PermissionApprovalQueue();
    const first = queue.enqueue(request({ requestId: 'req_c1', kind: 'patch' }), { meetingId: 'meet-clear', timeoutMs: 5_000 });
    queue.decide('req_c1', 'allow_session');
    await expect(first).resolves.toBe('allow');

    queue.clear();

    const second = queue.enqueue(request({ requestId: 'req_c2', kind: 'patch' }), { meetingId: 'meet-clear', timeoutMs: 5_000 });
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_c2', 'deny');
    await expect(second).resolves.toBe('deny');
  });

  it('allow_session on an entry without meetingId degrades to a plain allow', async () => {
    const queue = new PermissionApprovalQueue();
    const promise = queue.enqueue(request({ requestId: 'req_nm' }), { timeoutMs: 5_000 });

    expect(queue.decide('req_nm', 'allow_session')).toBe(true);
    await expect(promise).resolves.toBe('allow');

    // No grant was recorded (nowhere to scope it to).
    const next = queue.enqueue(request({ requestId: 'req_nm2' }), { timeoutMs: 5_000 });
    expect(queue.list()).toHaveLength(1);
    queue.decide('req_nm2', 'deny');
    await expect(next).resolves.toBe('deny');
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

  it('POST decide decodes URL-encoded ids (tool ids contain ":")', async () => {
    // Live-checklist regression (2026-09-01): driver permission ids look like
    // "Write:call_42bd…" and the client sends them URL-encoded
    // (`encodeURIComponent`). The server must decode before the queue lookup,
    // otherwise every approval-card button 404s.
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const askHuman = createDeskAskHuman(server.permissionApprovals, { timeoutMs: 5_000 });
    const requestId = 'Write:call_42bdb4a2d3854d10b274ea7f';
    const promise = askHuman(request({ requestId, kind: 'tool', title: 'Write: approval-test.txt' }));

    const base = `http://localhost:${server.getPort()}`;
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

    const res = await fetch(`${base}/api/permissions/${encodeURIComponent(requestId)}/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(promise).resolves.toBe('allow');
  });

  it('POST decide accepts allow_session and grants the meeting+kind', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const askHuman = createDeskAskHuman(server.permissionApprovals, { meetingId: 'meet-sess', timeoutMs: 5_000 });
    const first = askHuman(request({ requestId: 'req_sess_1', kind: 'tool' }));

    const base = `http://localhost:${server.getPort()}`;
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

    const res = await fetch(`${base}/api/permissions/req_sess_1/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow_session' }),
    });
    expect(res.status).toBe(200);
    await expect(first).resolves.toBe('allow');

    // The grant is live: a second same-kind request for that meeting never
    // reaches the pending list.
    const second = askHuman(request({ requestId: 'req_sess_2', kind: 'tool' }));
    await expect(second).resolves.toBe('allow');
    const pending = (await (await fetch(`${base}/api/permissions/pending`, { headers })).json()) as { pending: unknown[] };
    expect(pending.pending).toEqual([]);

    // Invalid decision values (including the old two-value vocabulary only)
    // still 400 for anything else.
    const bad = await fetch(`${base}/api/permissions/whatever/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow_for_day' }),
    });
    expect(bad.status).toBe(400);
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
