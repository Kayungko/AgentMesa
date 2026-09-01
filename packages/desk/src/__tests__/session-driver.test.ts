import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMeeting,
  createRuntimeContext,
  initWorkspace,
  registerAgent,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { ActivateSessionAgentOptions } from '@agentmesa/runner';
import {
  activateSessionAgent,
  adoptExternalDriverSession,
  loadDriverSessionHandle,
  SESSION_DRIVER_PREFERENCE_ENV,
} from '@agentmesa/runner';
import { DeskServer } from '../server.js';

// Spy-only mock: keep the real runner surface (terminateSessionChildren etc.),
// replace activateSessionAgent so the driver-selection wiring can be asserted
// without spawning any CLI child.
vi.mock('@agentmesa/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentmesa/runner')>();
  return {
    ...actual,
    activateSessionAgent: vi.fn(
      async (_ctx: unknown, _meetingId: string, agentId: string) => ({
        run: { id: 'run_session_test', status: 'completed', agentId },
        executed: true,
      }),
    ),
  };
});

let testDir: string;
let ctx: MesaRuntimeContext;
let server: DeskServer;
let prevSessionDriver: string | undefined;
let prevDriver: string | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-session-driver-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
  prevSessionDriver = process.env[SESSION_DRIVER_PREFERENCE_ENV];
  prevDriver = process.env.AGENTMESA_DRIVER;
  delete process.env[SESSION_DRIVER_PREFERENCE_ENV];
  delete process.env.AGENTMESA_DRIVER;
});

afterEach(async () => {
  if (server) {
    await server.stop();
  }
  rmSync(testDir, { recursive: true, force: true });
  if (prevSessionDriver === undefined) delete process.env[SESSION_DRIVER_PREFERENCE_ENV];
  else process.env[SESSION_DRIVER_PREFERENCE_ENV] = prevSessionDriver;
  if (prevDriver === undefined) delete process.env.AGENTMESA_DRIVER;
  else process.env.AGENTMESA_DRIVER = prevDriver;
  vi.mocked(activateSessionAgent).mockClear();
});

function lastOptions(): ActivateSessionAgentOptions {
  const call = vi.mocked(activateSessionAgent).mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![3] ?? {};
}

/** Invite the agent via the HTTP endpoint and wait for the fire-and-forget activation. */
async function inviteAgent(meetingId: string, agentId: string): Promise<void> {
  const base = `http://localhost:${server.getPort()}`;
  const res = await fetch(`${base}/api/meetings/${meetingId}/agents`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
  expect(res.status).toBe(200);
  // The endpoint returns immediately; the activation runs detached.
  await vi.waitFor(() => {
    expect(activateSessionAgent).toHaveBeenCalled();
  });
}

describe('DeskServer meeting-agent activation driver selection', () => {
  it('env unset keeps the plain CLI path — no driver options', async () => {
    registerAgent(ctx, {
      id: 'agent:claude',
      name: 'Claude',
      client: 'claude',
      status: 'available',
      roles: ['builder'],
    });
    const meeting = createMeeting(ctx, { title: '默认 CLI' });

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:claude');

    const options = lastOptions();
    expect('driverRegistry' in options).toBe(false);
    expect('driverPreference' in options).toBe(false);
    expect('permissionResponder' in options).toBe(false);
    expect(options.timeout).toBe(5000);
  });

  it('explicit claude-agent-sdk with a claude-family agent passes registry, preference and responder', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'claude-agent-sdk';
    registerAgent(ctx, {
      id: 'agent:claude',
      name: 'Claude',
      client: 'claude',
      status: 'available',
      roles: ['builder'],
    });
    const meeting = createMeeting(ctx, { title: '深度驱动' });

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:claude');

    const options = lastOptions();
    expect(options.driverPreference).toBe('claude-agent-sdk');
    expect(Array.isArray(options.driverRegistry)).toBe(true);
    expect(options.driverRegistry!.length).toBeGreaterThan(0);
    expect(typeof options.permissionResponder).toBe('function');
    expect(options.timeout).toBe(5000);

    // Behavioural speech-guard assertions: read-only commands pass through,
    // while gated actions (patch / mutating tool) escalate to the desk human
    // approval gate — they land in /api/permissions/pending as approval cards
    // instead of being silently denied (the takeover deadlock fix).
    const responder = options.permissionResponder!;
    const commandDecision = await responder({
      requestId: 'req-cmd',
      kind: 'command',
      title: 'command: git status',
      detail: { command: 'git status' },
    });
    expect(commandDecision).toBe('allow');

    // Gated actions pend on the human gate; assert the approval card landed.
    const patchPromise = responder({
      requestId: 'req-patch',
      kind: 'patch',
      title: 'patch: src/a.ts',
      detail: { changes: [{ path: 'src/a.ts', kind: 'modify' }] },
    });
    const writePromise = responder({
      requestId: 'req-write',
      kind: 'tool',
      title: 'tool: Write',
      detail: { toolName: 'Write', file_path: 'src/a.ts' },
    });
    const base = `http://localhost:${server.getPort()}`;
    await vi.waitFor(async () => {
      const res = await fetch(`${base}/api/permissions/pending`, {
        headers: { Authorization: 'Bearer secret' },
      });
      const body = (await res.json()) as { pending: Array<{ id: string }> };
      const ids = body.pending.map((entry) => entry.id);
      expect(ids).toContain('req-patch');
      expect(ids).toContain('req-write');
    });
    // The verdicts stay undecided while no human has answered (never resolve
    // within the test window — the promises are intentionally left pending;
    // the desk shutdown path resolves them as denied).
    const settled = await Promise.race([
      Promise.allSettled([patchPromise, writePromise]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    expect(settled).toBe(false);
  });

  it('auto with a codex-family agent keeps the CLI path', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'auto';
    registerAgent(ctx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    const meeting = createMeeting(ctx, { title: 'codex 保守' });

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:codex');

    const options = lastOptions();
    expect('driverRegistry' in options).toBe(false);
    expect('driverPreference' in options).toBe(false);
    expect('permissionResponder' in options).toBe(false);
  });

  it('an adopted external handle activates strict resume semantics', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'codex-app-server';
    registerAgent(ctx, {
      id: 'agent:codex-external',
      name: 'Codex External',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });
    const meeting = createMeeting(ctx, { title: '接管总控' });

    // Seed the sidecar exactly like POST /api/meetings/import?adopt=true does:
    // an externally adopted handle for this agent+meeting scope.
    adoptExternalDriverSession(ctx, {
      agentId: 'agent:codex-external',
      scope: meeting.id,
      kind: 'codex-app-server',
      backendSessionId: 'thread-external-takeover',
    });
    expect(loadDriverSessionHandle(ctx, 'agent:codex-external', meeting.id)?.adopted).toBe(true);

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:codex-external');

    const options = lastOptions();
    expect(options.resumeMode).toBe('strict');
  });

  it('an organically-grown handle (no adoption) keeps fallback resume semantics', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'codex-app-server';
    registerAgent(ctx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });
    const meeting = createMeeting(ctx, { title: '自然会话' });

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:codex');

    const options = lastOptions();
    expect(options.resumeMode).toBeUndefined();
  });

  it('AGENTMESA_DRIVER=cli does not empty the session driver registry once the session switch opted in', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'claude-agent-sdk';
    process.env.AGENTMESA_DRIVER = 'cli';
    registerAgent(ctx, {
      id: 'agent:claude',
      name: 'Claude',
      client: 'claude',
      status: 'available',
      roles: ['builder'],
    });
    const meeting = createMeeting(ctx, { title: '双开关' });

    server = new DeskServer(testDir, 0, { sessionToken: 'secret', sessionRunTimeout: 5000 });
    await server.start();
    await inviteAgent(meeting.id, 'agent:claude');

    // The task-run switch (AGENTMESA_DRIVER=cli) must not silently degrade
    // meeting-speech deep drivers back to the one-shot CLI path.
    const options = lastOptions();
    expect(options.driverPreference).toBe('claude-agent-sdk');
    expect(options.driverRegistry!.length).toBeGreaterThan(0);
  });

  // Note: the "unregistered agent id falls back to CLI" guard cannot be
  // exercised through the HTTP endpoint (the invite requires a registered
  // agent); it is covered on the MCP side in mcp-server's
  // session-driver-tools.test.ts.
});
