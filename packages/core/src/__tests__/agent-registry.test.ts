import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { getAgent, listAgents, registerAgent, selfRegisterAgent, actorRefOf } from '../services/agent-registry.js';
import { AgentNotFoundError } from '../errors.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('agent registry', () => {
  it('registers, gets, and lists agents', () => {
    const agent = registerAgent(ctx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });

    expect(agent.id).toBe('agent:codex');
    expect(getAgent(ctx, agent.id).name).toBe('Codex');
    expect(listAgents(ctx)).toHaveLength(1);
  });

  it('throws for missing agents', () => {
    expect(() => getAgent(ctx, 'agent:missing')).toThrow(AgentNotFoundError);
  });

  it('records registration events with runtime actor', () => {
    const agent = registerAgent(ctx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    const events = ctx.eventStore.list({ streamId: agent.id });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('agent_registered');
    expect(events[0]!.actor).toBe('user:test');
  });

  it('rejects registrations denied by policy', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:blocked', type: 'agent', roles: ['reviewer'] },
      policy: { can: () => ({ allowed: false, reason: 'blocked' }), canWithContext: () => ({ allowed: false, reason: 'blocked' }) },
    });

    expect(() =>
      registerAgent(deniedCtx, {
        id: 'agent:codex',
        name: 'Codex',
        client: 'codex',
        status: 'available',
        roles: ['reviewer'],
      })
    ).toThrow('Policy denied');
  });
});

describe('selfRegisterAgent', () => {
  function downgradedCtx(actorId: string): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: testDir,
      actor: { id: actorId, type: 'agent', roles: ['read_only'], client: 'mcp-http' },
    });
  }

  it('lets a read-only actor register itself under non-privileged roles (bootstrap)', () => {
    const bootCtx = downgradedCtx('agent:remote-bot');
    const agent = selfRegisterAgent(bootCtx, {
      id: 'agent:remote-bot',
      name: 'Remote Bot',
      client: 'remote',
      status: 'available',
      roles: ['builder'],
    });

    expect(agent.roles).toEqual(['builder']);
    expect(getAgent(ctx, 'agent:remote-bot').name).toBe('Remote Bot');
    const events = ctx.eventStore.list({ streamId: 'agent:remote-bot' });
    expect(events.at(-1)?.type).toBe('agent_registered');
  });

  it('refuses privileged roles with the allowlist in the error', () => {
    const bootCtx = downgradedCtx('agent:remote-bot');
    expect(() =>
      selfRegisterAgent(bootCtx, {
        id: 'agent:remote-bot',
        name: 'Remote Bot',
        client: 'remote',
        status: 'available',
        roles: ['chair'],
      })
    ).toThrow(/privileged/);
  });

  it('refuses registering an id other than the actor own', () => {
    const bootCtx = downgradedCtx('agent:remote-bot');
    expect(() =>
      selfRegisterAgent(bootCtx, {
        id: 'agent:someone-else',
        name: 'Impersonation',
        client: 'remote',
        status: 'available',
        roles: ['builder'],
      })
    ).toThrow(/does not match the current actor/);
  });

  it('never overwrites an existing registration (operator channel owns updates)', () => {
    registerAgent(ctx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    const bootCtx = downgradedCtx('agent:codex');

    expect(() =>
      selfRegisterAgent(bootCtx, {
        id: 'agent:codex',
        name: 'Rewritten',
        client: 'codex',
        status: 'available',
        roles: ['builder'],
      })
    ).toThrow(/already registered/);
    // The original entry is untouched.
    expect(getAgent(ctx, 'agent:codex').roles).toEqual(['reviewer']);
  });

  it('actorRefOf normalizes prefixed ids and passes bare ids through', () => {
    expect(actorRefOf('agent:codex')).toBe('codex');
    expect(actorRefOf('remote:member:1')).toBe('member:1');
    expect(actorRefOf('user')).toBe('user');
  });
});
