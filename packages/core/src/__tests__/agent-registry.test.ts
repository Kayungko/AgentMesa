import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { getAgent, listAgents, registerAgent } from '../services/agent-registry.js';
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
