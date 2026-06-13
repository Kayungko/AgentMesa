import { describe, it, expect } from 'vitest';
import { RoleBasedPolicyEngine, AllowAllMesaPolicyEngine } from '../runtime/policy.js';
import type { MesaActor } from '../runtime/types.js';

function actor(overrides: Partial<MesaActor> = {}): MesaActor {
  return {
    id: 'agent:test',
    type: 'agent',
    roles: ['builder'],
    ...overrides,
  };
}

describe('AllowAllMesaPolicyEngine', () => {
  it('allows every action', () => {
    const policy = new AllowAllMesaPolicyEngine();
    expect(policy.can(actor(), 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(actor(), 'unknown.action', 'x').allowed).toBe(true);
  });
});

describe('RoleBasedPolicyEngine', () => {
  const policy = new RoleBasedPolicyEngine();

  it('allows owner role regardless of action', () => {
    const owner = actor({ roles: ['owner'] });
    // Owner bypasses capability check for ANY action
    expect(policy.can(owner, 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(owner, 'meeting.create', 'm1').allowed).toBe(true);
    expect(policy.can(owner, 'artifact.create', 'a1').allowed).toBe(true);
    expect(policy.can(owner, 'nonexistent.action', 'x').allowed).toBe(true);
  });

  it('allows builder to create tasks', () => {
    expect(policy.can(actor({ roles: ['builder'] }), 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(actor({ roles: ['builder'] }), 'task.assign', 't1').allowed).toBe(true);
    expect(policy.can(actor({ roles: ['builder'] }), 'task.updateStatus', 't1').allowed).toBe(true);
  });

  it('denies builder from deleting tasks', () => {
    const result = policy.can(actor({ roles: ['builder'] }), 'task.delete', 't1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('lacks capability');
    expect(result.reason).toContain('delete_task');
  });

  it('denies builder from managing agents', () => {
    const result = policy.can(actor({ roles: ['builder'] }), 'agent.register', 'a1');
    expect(result.allowed).toBe(false);
  });

  it('allows maintainer to do everything', () => {
    const m = actor({ roles: ['maintainer'] });
    expect(policy.can(m, 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(m, 'task.delete', 't1').allowed).toBe(true);
    expect(policy.can(m, 'meeting.create', 'm1').allowed).toBe(true);
    expect(policy.can(m, 'agent.register', 'a1').allowed).toBe(true);
    expect(policy.can(m, 'artifact.create', 'a1').allowed).toBe(true);
  });

  it('allows reviewer to read tasks and create artifacts', () => {
    const r = actor({ roles: ['reviewer'] });
    expect(policy.can(r, 'task.updateStatus', 't1').allowed).toBe(true);
    expect(policy.can(r, 'artifact.create', 'a1').allowed).toBe(true);
    expect(policy.can(r, 'message.send', 'm1').allowed).toBe(true);
  });

  it('denies reviewer from writing tasks', () => {
    const result = policy.can(actor({ roles: ['reviewer'] }), 'task.create', 't1');
    expect(result.allowed).toBe(false);
  });

  it('denies unknown role', () => {
    const unknown = { id: 'agent:anon', type: 'agent' as const, roles: ['unknown_role'] as unknown as MesaActor['roles'] };
    const result = policy.can(unknown, 'task.create', 't1');
    expect(result.allowed).toBe(false);
  });

  it('denies unmapped actions', () => {
    const result = policy.can(actor({ roles: ['builder'] }), 'unknown.verb', 'x');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown action');
  });

  it('checks any matching role (first match wins)', () => {
    // A builder+reviewer can write tasks (builder allows it)
    const dual = actor({ roles: ['reviewer', 'builder'] });
    expect(policy.can(dual, 'task.create', 't1').allowed).toBe(true);
  });

  it('accepts capability overrides in constructor', () => {
    const custom = new RoleBasedPolicyEngine({
      reviewer: ['write_task', 'delete_task'],
    });
    const r = actor({ roles: ['reviewer'] });
    expect(custom.can(r, 'task.create', 't1').allowed).toBe(true);
    expect(custom.can(r, 'task.delete', 't1').allowed).toBe(true);
  });

  it('returns reason string on deny', () => {
    const result = policy.can(actor({ id: 'agent-x', roles: ['tester'] }), 'meeting.create', 'm1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('agent-x');
    expect(result.reason).toContain('tester');
    expect(result.reason).toContain('meeting.create');
  });
});
