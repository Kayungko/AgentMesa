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
import { activateSessionAgent, SESSION_DRIVER_PREFERENCE_ENV } from '@agentmesa/runner';
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

    // Behavioural speech-guard assertions: the assembled responder must keep
    // meeting-speech turns read-only (patch → deny, readonly command → allow)
    // regardless of the agent's registered builder role.
    const responder = options.permissionResponder!;
    const patchDecision = await responder({
      requestId: 'req-patch',
      kind: 'patch',
      title: 'patch: src/a.ts',
      detail: { changes: [{ path: 'src/a.ts', kind: 'modify' }] },
    });
    expect(patchDecision).toBe('deny');
    const commandDecision = await responder({
      requestId: 'req-cmd',
      kind: 'command',
      title: 'command: git status',
      detail: { command: 'git status' },
    });
    expect(commandDecision).toBe('allow');
    const writeDecision = await responder({
      requestId: 'req-write',
      kind: 'tool',
      title: 'tool: Write',
      detail: { toolName: 'Write', file_path: 'src/a.ts' },
    });
    expect(writeDecision).toBe('deny');
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

  // Note: the "unregistered agent id falls back to CLI" guard cannot be
  // exercised through the HTTP endpoint (the invite requires a registered
  // agent); it is covered on the MCP side in mcp-server's
  // session-driver-tools.test.ts.
});
