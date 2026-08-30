import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace, registerAgent } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { ActivateSessionAgentOptions } from '@agentmesa/runner';
import { activateSessionAgent, SESSION_DRIVER_PREFERENCE_ENV } from '@agentmesa/runner';
import { handleActivateSessionAgent } from '../tools.js';

// Spy-only mock: keep the real runner surface, replace activateSessionAgent so
// the driver-selection wiring can be asserted without spawning any CLI child.
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
let prevSessionDriver: string | undefined;
let prevDriver: string | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-mcp-session-driver-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  prevSessionDriver = process.env[SESSION_DRIVER_PREFERENCE_ENV];
  prevDriver = process.env.AGENTMESA_DRIVER;
  delete process.env[SESSION_DRIVER_PREFERENCE_ENV];
  delete process.env.AGENTMESA_DRIVER;
});

afterEach(() => {
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

describe('handleActivateSessionAgent driver selection', () => {
  it('env unset keeps the plain CLI path — no driver options', async () => {
    registerAgent(ctx, {
      id: 'agent:claude',
      name: 'Claude',
      client: 'claude',
      status: 'available',
      roles: ['builder'],
    });

    await handleActivateSessionAgent(ctx, { meetingId: 'meeting_x', agentId: 'agent:claude' });

    const options = lastOptions();
    expect('driverRegistry' in options).toBe(false);
    expect('driverPreference' in options).toBe(false);
    expect('permissionResponder' in options).toBe(false);
    expect(Object.keys(options)).toHaveLength(0);
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

    await handleActivateSessionAgent(ctx, { meetingId: 'meeting_x', agentId: 'agent:claude' });

    const options = lastOptions();
    expect(options.driverPreference).toBe('claude-agent-sdk');
    expect(Array.isArray(options.driverRegistry)).toBe(true);
    expect(options.driverRegistry!.length).toBeGreaterThan(0);
    expect(typeof options.permissionResponder).toBe('function');

    // Behavioural speech-guard assertion: the assembled responder keeps
    // meeting-speech turns read-only despite the builder role.
    const responder = options.permissionResponder!;
    await expect(responder({
      requestId: 'req-patch',
      kind: 'patch',
      title: 'patch: src/a.ts',
      detail: { changes: [{ path: 'src/a.ts', kind: 'modify' }] },
    })).resolves.toBe('deny');
    await expect(responder({
      requestId: 'req-write',
      kind: 'tool',
      title: 'tool: Write',
      detail: { toolName: 'Write', file_path: 'src/a.ts' },
    })).resolves.toBe('deny');
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

    await handleActivateSessionAgent(ctx, { meetingId: 'meeting_x', agentId: 'agent:codex' });

    const options = lastOptions();
    expect('driverRegistry' in options).toBe(false);
    expect('driverPreference' in options).toBe(false);
    expect('permissionResponder' in options).toBe(false);
  });

  it('explicit preference with an unregistered agent conservatively falls back to CLI', async () => {
    process.env[SESSION_DRIVER_PREFERENCE_ENV] = 'claude-agent-sdk';

    await handleActivateSessionAgent(ctx, { meetingId: 'meeting_x', agentId: 'agent:ghost' });

    const options = lastOptions();
    expect('driverRegistry' in options).toBe(false);
    expect('driverPreference' in options).toBe(false);
    expect('permissionResponder' in options).toBe(false);
  });

  it('forwards a timeout on the CLI path unchanged', async () => {
    registerAgent(ctx, {
      id: 'agent:claude',
      name: 'Claude',
      client: 'claude',
      status: 'available',
      roles: ['builder'],
    });

    await handleActivateSessionAgent(ctx, {
      meetingId: 'meeting_x',
      agentId: 'agent:claude',
      timeout: 1234,
    });

    expect(lastOptions().timeout).toBe(1234);
  });
});
