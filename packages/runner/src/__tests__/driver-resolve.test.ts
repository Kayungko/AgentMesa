import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgent } from '@agentmesa/protocol';
import {
  DRIVER_PREFERENCE_ENV,
  clientToDriverKind,
  driverSessionScope,
  loadDriverSessionHandle,
  parseDriverPreference,
  resolveDriverPreference,
  resolveDriverTransport,
  saveDriverSessionHandle,
} from '../drivers/resolve.js';
import type { AgentDriver, DriverKind, DriverSessionHandle } from '../drivers/types.js';

let testDir: string;
let ctx: MesaRuntimeContext;
const prevEnv = process.env[DRIVER_PREFERENCE_ENV];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-driver-resolve-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env[DRIVER_PREFERENCE_ENV];
  } else {
    process.env[DRIVER_PREFERENCE_ENV] = prevEnv;
  }
  rmSync(testDir, { recursive: true, force: true });
});

function stubDriver(kind: DriverKind, available: boolean | Error = true): AgentDriver {
  return {
    kind,
    name: kind,
    async isAvailable() {
      if (available instanceof Error) {
        throw available;
      }
      return available;
    },
    async createSession() {
      throw new Error('createSession must not be called during resolution');
    },
    async resumeSession() {
      throw new Error('resumeSession must not be called during resolution');
    },
  };
}

function agentWithClient(client: string | undefined): MesaAgent | undefined {
  if (client === undefined) {
    return undefined;
  }
  return {
    id: 'agent:x',
    name: 'X',
    client,
    roles: ['builder'],
    status: 'available',
  };
}

describe('parseDriverPreference', () => {
  it('defaults to auto for empty or missing values', () => {
    expect(parseDriverPreference(undefined)).toEqual({ kind: 'auto' });
    expect(parseDriverPreference('')).toEqual({ kind: 'auto' });
    expect(parseDriverPreference('   ')).toEqual({ kind: 'auto' });
    expect(parseDriverPreference(null)).toEqual({ kind: 'auto' });
  });

  it('accepts the four documented values', () => {
    expect(parseDriverPreference('auto')).toEqual({ kind: 'auto' });
    expect(parseDriverPreference('cli')).toEqual({ kind: 'cli' });
    expect(parseDriverPreference('claude-agent-sdk')).toEqual({ kind: 'claude-agent-sdk' });
    expect(parseDriverPreference('codex-app-server')).toEqual({ kind: 'codex-app-server' });
    expect(parseDriverPreference('  codex-app-server  ')).toEqual({ kind: 'codex-app-server' });
  });

  it('falls back to auto for unknown values instead of throwing', () => {
    expect(parseDriverPreference('gpt')).toEqual({ kind: 'auto' });
    expect(parseDriverPreference('claude-sdk')).toEqual({ kind: 'auto' });
  });
});

describe('resolveDriverPreference', () => {
  it('reads AGENTMESA_DRIVER when no explicit value is given', () => {
    process.env[DRIVER_PREFERENCE_ENV] = 'cli';
    expect(resolveDriverPreference()).toEqual({ kind: 'cli' });
    process.env[DRIVER_PREFERENCE_ENV] = 'codex-app-server';
    expect(resolveDriverPreference()).toEqual({ kind: 'codex-app-server' });
  });

  it('defaults to auto without env or argument', () => {
    delete process.env[DRIVER_PREFERENCE_ENV];
    expect(resolveDriverPreference()).toEqual({ kind: 'auto' });
  });

  it('lets an explicit argument win over the env var', () => {
    process.env[DRIVER_PREFERENCE_ENV] = 'cli';
    expect(resolveDriverPreference('claude-agent-sdk')).toEqual({ kind: 'claude-agent-sdk' });
    expect(resolveDriverPreference({ kind: 'auto' })).toEqual({ kind: 'auto' });
  });
});

describe('clientToDriverKind', () => {
  it('maps claude clients to the claude-agent-sdk driver', () => {
    expect(clientToDriverKind('claude-code')).toBe('claude-agent-sdk');
    expect(clientToDriverKind('claude')).toBe('claude-agent-sdk');
  });

  it('maps codex clients to the codex-app-server driver', () => {
    expect(clientToDriverKind('codex')).toBe('codex-app-server');
  });

  it('returns undefined for unknown or missing clients', () => {
    expect(clientToDriverKind('remote')).toBeUndefined();
    expect(clientToDriverKind(undefined)).toBeUndefined();
    expect(clientToDriverKind('')).toBeUndefined();
  });
});

describe('resolveDriverTransport', () => {
  it('auto picks the driver matching the agent client (claude)', async () => {
    const claude = stubDriver('claude-agent-sdk');
    const codex = stubDriver('codex-app-server');
    const resolution = await resolveDriverTransport({ kind: 'auto' }, agentWithClient('claude-code'), [
      claude,
      codex,
    ]);
    expect(resolution.transport).toBe('driver');
    expect(resolution.driver).toBe(claude);
    expect(resolution.kind).toBe('claude-agent-sdk');
    expect(resolution.fallbackReason).toBeUndefined();
  });

  it('auto picks the driver matching the agent client (codex)', async () => {
    const claude = stubDriver('claude-agent-sdk');
    const codex = stubDriver('codex-app-server');
    const resolution = await resolveDriverTransport({ kind: 'auto' }, agentWithClient('codex'), [
      claude,
      codex,
    ]);
    expect(resolution.transport).toBe('driver');
    expect(resolution.driver).toBe(codex);
    expect(resolution.kind).toBe('codex-app-server');
  });

  it('auto falls back to cli when the mapped driver is unavailable', async () => {
    const claude = stubDriver('claude-agent-sdk', false);
    const resolution = await resolveDriverTransport({ kind: 'auto' }, agentWithClient('claude-code'), [
      claude,
    ]);
    expect(resolution.transport).toBe('cli');
    expect(resolution.driver).toBeUndefined();
    expect(resolution.fallbackReason).toContain('unavailable');
  });

  it('auto falls back to cli when the agent client has no driver mapping', async () => {
    const resolution = await resolveDriverTransport({ kind: 'auto' }, agentWithClient('remote'), [
      stubDriver('claude-agent-sdk'),
    ]);
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('no driver mapping');
  });

  it('auto falls back to cli when the agent is unknown', async () => {
    const resolution = await resolveDriverTransport({ kind: 'auto' }, undefined, [
      stubDriver('claude-agent-sdk'),
    ]);
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('no driver mapping');
  });

  it('an explicit kind uses that driver when available', async () => {
    const codex = stubDriver('codex-app-server');
    const resolution = await resolveDriverTransport(
      { kind: 'codex-app-server' },
      agentWithClient('claude-code'),
      [stubDriver('claude-agent-sdk'), codex],
    );
    expect(resolution.transport).toBe('driver');
    expect(resolution.driver).toBe(codex);
  });

  it('an explicit kind falls back to cli when the driver is not registered', async () => {
    const resolution = await resolveDriverTransport(
      { kind: 'codex-app-server' },
      agentWithClient('codex'),
      [stubDriver('claude-agent-sdk')],
    );
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('not registered');
  });

  it('an explicit kind falls back to cli when the driver is unavailable', async () => {
    const resolution = await resolveDriverTransport(
      { kind: 'claude-agent-sdk' },
      agentWithClient('claude-code'),
      [stubDriver('claude-agent-sdk', false)],
    );
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('unavailable');
  });

  it('a throwing isAvailable probe is treated as unavailable', async () => {
    const resolution = await resolveDriverTransport(
      { kind: 'claude-agent-sdk' },
      agentWithClient('claude-code'),
      [stubDriver('claude-agent-sdk', new Error('probe crashed'))],
    );
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('unavailable');
  });

  it('preference cli always takes the cli path', async () => {
    const resolution = await resolveDriverTransport({ kind: 'cli' }, agentWithClient('claude-code'), [
      stubDriver('claude-agent-sdk'),
    ]);
    expect(resolution.transport).toBe('cli');
    expect(resolution.driver).toBeUndefined();
  });

  it('an empty registry falls back to cli', async () => {
    const resolution = await resolveDriverTransport({ kind: 'auto' }, agentWithClient('claude-code'), []);
    expect(resolution.transport).toBe('cli');
    expect(resolution.fallbackReason).toContain('no deep drivers registered');
  });
});

describe('driver session handle store', () => {
  const handle: DriverSessionHandle = {
    kind: 'claude-agent-sdk',
    backendSessionId: 'sess-abc',
    createdAt: '2026-08-30T00:00:00.000Z',
  };

  it('driverSessionScope prefers meetingId, then taskId, then a global scope', () => {
    expect(driverSessionScope({ meetingId: 'meet_1', taskId: 'task_1' })).toBe('meet_1');
    expect(driverSessionScope({ meetingId: undefined, taskId: 'task_1' })).toBe('task_1');
    expect(driverSessionScope({ meetingId: undefined, taskId: undefined })).toBe('_global');
  });

  it('returns undefined when nothing was persisted', () => {
    expect(loadDriverSessionHandle(ctx, 'agent:none', 'meet_1')).toBeUndefined();
  });

  it('round-trips a handle per agent and scope', () => {
    saveDriverSessionHandle(ctx, 'agent:claude', 'meet_1', handle, 'run_1');
    const loaded = loadDriverSessionHandle(ctx, 'agent:claude', 'meet_1');
    expect(loaded).toEqual(handle);

    // A different scope for the same agent has no handle yet…
    expect(loadDriverSessionHandle(ctx, 'agent:claude', 'meet_2')).toBeUndefined();
    // …and another agent has nothing at all.
    expect(loadDriverSessionHandle(ctx, 'agent:codex', 'meet_1')).toBeUndefined();
  });

  it('overwrites only the targeted scope', () => {
    saveDriverSessionHandle(ctx, 'agent:claude', 'meet_1', handle);
    const second: DriverSessionHandle = {
      kind: 'claude-agent-sdk',
      backendSessionId: 'sess-xyz',
      createdAt: '2026-08-30T01:00:00.000Z',
    };
    saveDriverSessionHandle(ctx, 'agent:claude', 'meet_2', second);
    saveDriverSessionHandle(ctx, 'agent:claude', 'meet_1', {
      kind: 'claude-agent-sdk',
      backendSessionId: 'sess-new',
      createdAt: '2026-08-30T02:00:00.000Z',
    });

    expect(loadDriverSessionHandle(ctx, 'agent:claude', 'meet_1')?.backendSessionId).toBe('sess-new');
    expect(loadDriverSessionHandle(ctx, 'agent:claude', 'meet_2')?.backendSessionId).toBe('sess-xyz');
  });

  it('sanitizes agent ids that are not filesystem-safe', () => {
    saveDriverSessionHandle(ctx, 'agent:claude!main', 'meet_1', handle);
    expect(loadDriverSessionHandle(ctx, 'agent:claude!main', 'meet_1')).toEqual(handle);
  });

  it('treats corrupted handle files as missing', () => {
    mkdirSync(join(testDir, '.agentmesa', 'driver-sessions'), { recursive: true });
    writeFileSync(join(testDir, '.agentmesa', 'driver-sessions', 'broken.json'), 'not json', 'utf-8');
    expect(loadDriverSessionHandle(ctx, 'broken', 'meet_1')).toBeUndefined();
  });
});
