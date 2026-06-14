import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RoleBasedPolicyEngine, AllowAllMesaPolicyEngine } from '../runtime/policy.js';
import type { MesaActor, MesaRuntimeContext } from '../runtime/types.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import { initWorkspace, createTask, deleteTask, updateTaskStatus } from '../index.js';
import { PolicyDeniedError } from '../errors.js';

function actor(overrides: Partial<MesaActor> = {}): MesaActor {
  return {
    id: 'agent:test',
    type: 'agent',
    roles: ['builder'],
    ...overrides,
  };
}

// --- Runtime context fixture helpers (Task 3) ---

let testDirs: string[] = [];

function makeCleanDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'agentmesa-policy-'));
  testDirs.push(d);
  return d;
}

/**
 * Creates a MesaRuntimeContext with role-based policy enforcement.
 * By default the actor has ['owner'] so tests can exercise specific roles
 * by passing overrides.
 */
function makeRoleBasedContext(
  actorOverrides?: Partial<MesaActor>,
  policyOverrides?: Record<string, string[]>,
): MesaRuntimeContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const policy = policyOverrides ? new RoleBasedPolicyEngine(policyOverrides as any) : undefined;
  const rootDir = makeCleanDir();
  const storage = new FileStorageAdapter();
  initWorkspace(rootDir);
  const configPath = join(rootDir, '.agentmesa', 'config.json');
  storage.writeText(
    configPath,
    JSON.stringify({ protocolVersion: '0.2.0', policy: { mode: 'role-based' } }, null, 2) + '\n',
  );
  return createRuntimeContext({
    rootDir,
    actor: { id: 'agent:test', type: 'agent', roles: ['builder'], ...actorOverrides },
    storage,
    policy,
  });
}

function makeAllowAllContext(actorOverrides?: Partial<MesaActor>): MesaRuntimeContext {
  const rootDir = makeCleanDir();
  const storage = new FileStorageAdapter();
  initWorkspace(rootDir);
  const configPath = join(rootDir, '.agentmesa', 'config.json');
  storage.writeText(
    configPath,
    JSON.stringify({ protocolVersion: '0.2.0' }, null, 2) + '\n',
  );
  return createRuntimeContext({
    rootDir,
    actor: { id: 'agent:test', type: 'agent', roles: ['builder'], ...actorOverrides },
    storage,
  });
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  for (const d of testDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

// --- AllowAllMesaPolicyEngine ---

describe('AllowAllMesaPolicyEngine', () => {
  it('allows every action', () => {
    const policy = new AllowAllMesaPolicyEngine();
    expect(policy.can(actor(), 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(actor(), 'unknown.action', 'x').allowed).toBe(true);
  });

  it('canWithContext also allows every action', () => {
    const policy = new AllowAllMesaPolicyEngine();
    expect(policy.canWithContext(actor(), 'task.create', 't1', { task: { status: 'todo' } }).allowed).toBe(true);
    expect(policy.canWithContext(actor(), 'unknown.action', 'x').allowed).toBe(true);
  });
});

// --- RoleBasedPolicyEngine: engine-level tests ---

describe('RoleBasedPolicyEngine', () => {
  const policy = new RoleBasedPolicyEngine();

  it('allows owner role regardless of action', () => {
    const owner = actor({ roles: ['owner'] });
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

  it('denies builder from archiving tasks', () => {
    const result = policy.can(actor({ roles: ['builder'] }), 'task.archive', 't1');
    expect(result.allowed).toBe(false);
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
    expect(policy.canWithContext(r, 'task.updateStatus', 't1', { targetStatus: 'approved' }).allowed).toBe(true);
    expect(policy.can(r, 'artifact.create', 'a1').allowed).toBe(true);
    expect(policy.can(r, 'message.append', 'm1').allowed).toBe(true);
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

  it('treats archive and delete as independent capabilities', () => {
    const b = actor({ roles: ['builder'] });
    expect(policy.can(b, 'task.archive', 't1').allowed).toBe(false);
    expect(policy.can(b, 'task.delete', 't1').allowed).toBe(false);

    const c = actor({ roles: ['chair'] });
    expect(policy.can(c, 'task.archive', 't1').allowed).toBe(true);
    expect(policy.can(c, 'task.delete', 't1').allowed).toBe(true);

    const m = actor({ roles: ['maintainer'] });
    expect(policy.can(m, 'task.archive', 't1').allowed).toBe(true);
    expect(policy.can(m, 'task.delete', 't1').allowed).toBe(true);
  });

  it('grants archive_task only to chair, maintainer, owner, and admin', () => {
    const privileged: MesaActor['roles'] = ['chair', 'maintainer', 'owner', 'admin'] as unknown as MesaActor['roles'];
    for (const role of privileged) {
      expect(policy.can(actor({ roles: [role] }), 'task.archive', 't1').allowed).toBe(true);
    }

    const unprivileged: MesaActor['roles'] = ['planner', 'reviewer', 'tester', 'documenter', 'researcher', 'builder', 'connector', 'ci'] as unknown as MesaActor['roles'];
    for (const role of unprivileged) {
      expect(policy.can(actor({ roles: [role] }), 'task.archive', 't1').allowed).toBe(false);
    }
  });

  // --- New role tests (Task 4) ---

  it('allows admin full access', () => {
    const a = actor({ roles: ['admin'] });
    expect(policy.can(a, 'task.create', 't1').allowed).toBe(true);
    expect(policy.can(a, 'task.delete', 't1').allowed).toBe(true);
    expect(policy.can(a, 'agent.register', 'a1').allowed).toBe(true);
    expect(policy.can(a, 'projection.rebuild', 'p1').allowed).toBe(true);
    expect(policy.can(a, 'task.archive', 't1').allowed).toBe(true);
  });

  it('denies connector from task.delete', () => {
    const c = actor({ roles: ['connector'] });
    expect(policy.can(c, 'task.delete', 't1').allowed).toBe(false);
  });

  it('denies connector from task.create', () => {
    const c = actor({ roles: ['connector'] });
    expect(policy.can(c, 'task.create', 't1').allowed).toBe(false);
  });

  it('allows connector to post messages and create artifacts', () => {
    const c = actor({ roles: ['connector'] });
    expect(policy.can(c, 'message.append', 'm1').allowed).toBe(true);
    expect(policy.can(c, 'artifact.create', 'a1').allowed).toBe(true);
  });

  it('allows connector to read events and projections', () => {
    const c = actor({ roles: ['connector'] });
    expect(policy.can(c, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(c, 'projection.read', 'p1').allowed).toBe(true);
  });

  it('allows ci to post messages and create artifacts', () => {
    const c = actor({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(policy.can(c, 'message.append', 'm1').allowed).toBe(true);
    expect(policy.can(c, 'artifact.create', 'a1').allowed).toBe(true);
  });

  it('denies ci from task.delete', () => {
    const c = actor({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(policy.can(c, 'task.delete', 't1').allowed).toBe(false);
  });

  it('denies ci from task.create', () => {
    const c = actor({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(policy.can(c, 'task.create', 't1').allowed).toBe(false);
  });

  it('allows ci to read events and projections', () => {
    const c = actor({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(policy.can(c, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(c, 'projection.read', 'p1').allowed).toBe(true);
  });

  it('denies reviewer task.updateStatus without targetStatus context', () => {
    const r = actor({ roles: ['reviewer'] });
    // can() delegates to canWithContext() — reviewer requires context with targetStatus
    expect(policy.can(r, 'task.updateStatus', 't1').allowed).toBe(false);
  });

  it('allows reviewer to change task status when context provided', () => {
    expect(policy.canWithContext(actor({ roles: ['reviewer'] }), 'task.updateStatus', 't1', { targetStatus: 'approved' }).allowed).toBe(true);
  });

  it('denies reviewer from managing agents or meetings', () => {
    const r = actor({ roles: ['reviewer'] });
    expect(policy.can(r, 'agent.register', 'a1').allowed).toBe(false);
    expect(policy.can(r, 'meeting.create', 'm1').allowed).toBe(false);
  });

  it('allows system to rebuild projections', () => {
    const s = actor({ id: 'system:core', type: 'system', roles: ['system'] });
    expect(policy.can(s, 'projection.rebuild', 'p1').allowed).toBe(true);
    expect(policy.can(s, 'event.read', 'e1').allowed).toBe(true);
  });

  it('denies system from writing tasks', () => {
    const s = actor({ id: 'system:core', type: 'system', roles: ['system'] });
    expect(policy.can(s, 'task.create', 't1').allowed).toBe(false);
    expect(policy.can(s, 'message.append', 'm1').allowed).toBe(false);
  });

  // --- New action tests ---

  it('maps message.append to post_message (not message.send)', () => {
    // builder has post_message
    expect(policy.can(actor({ roles: ['builder'] }), 'message.append', 'm1').allowed).toBe(true);
    // The old action key should be denied as unknown
    const result = policy.can(actor({ roles: ['builder'] }), 'message.send', 'm1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown action');
  });

  it('maps new inspection actions correctly', () => {
    const b = actor({ roles: ['builder'] });
    expect(policy.can(b, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(b, 'projection.read', 'p1').allowed).toBe(true);
    // builder cannot rebuild projections
    expect(policy.can(b, 'projection.rebuild', 'p1').allowed).toBe(false);
  });

  it('denies builder from transport.inspect', () => {
    const b = actor({ roles: ['builder'] });
    expect(policy.can(b, 'transport.inspect', 't1').allowed).toBe(false);
  });

  it('allows transport.inspect only for owner, admin, chair, maintainer', () => {
    const privileged: MesaActor['roles'] = ['owner', 'admin', 'chair', 'maintainer'] as unknown as MesaActor['roles'];
    for (const role of privileged) {
      expect(policy.can(actor({ roles: [role] }), 'transport.inspect', 't1').allowed).toBe(true);
    }
    const restricted: MesaActor['roles'] = ['builder', 'reviewer', 'connector', 'ci', 'system', 'tester', 'planner'] as unknown as MesaActor['roles'];
    for (const role of restricted) {
      expect(policy.can(actor({ roles: [role] }), 'transport.inspect', 't1').allowed).toBe(false);
    }
  });

  // --- Read/inspect/rebuild action coverage ---

  it('allows connector to read events and projections', () => {
    const c = actor({ roles: ['connector'] });
    expect(policy.can(c, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(c, 'projection.read', 'p1').allowed).toBe(true);
    expect(policy.can(c, 'projection.rebuild', 'p1').allowed).toBe(false);
  });

  it('allows ci to read events and projections', () => {
    const c = actor({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(policy.can(c, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(c, 'projection.read', 'p1').allowed).toBe(true);
  });

  it('allows system to rebuild projections', () => {
    const s = actor({ id: 'system:core', type: 'system', roles: ['system'] });
    expect(policy.can(s, 'projection.rebuild', 'p1').allowed).toBe(true);
    expect(policy.can(s, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(s, 'projection.read', 'p1').allowed).toBe(true);
  });

  it('allows admin to read events and rebuild projections', () => {
    const a = actor({ roles: ['admin'] });
    expect(policy.can(a, 'event.read', 'e1').allowed).toBe(true);
    expect(policy.can(a, 'projection.rebuild', 'p1').allowed).toBe(true);
    expect(policy.can(a, 'transport.inspect', 't1').allowed).toBe(true);
  });

  // --- canWithContext tests (Task 5) ---

  it('canWithContext returns same result as can for builder', () => {
    const b = actor({ roles: ['builder'] });
    expect(policy.canWithContext(b, 'task.create', 't1', { task: { status: 'todo' } }).allowed).toBe(true);
    expect(policy.canWithContext(b, 'task.delete', 't1', { task: { status: 'todo' } }).allowed).toBe(false);
  });

  it('canWithContext passes through context but does not alter decision (current limit)', () => {
    const b = actor({ roles: ['builder'] });
    const decision = policy.canWithContext(b, 'task.create', 't1', {
      task: { status: 'in_progress' },
      meeting: { phase: 'active' },
    });
    expect(decision.allowed).toBe(true);
  });

  it('canWithContext returns deny with reason for unknown actions', () => {
    const result = policy.canWithContext(actor({ roles: ['builder'] }), 'unknown.action', 'x', {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown action');
  });

  it('canWithContext still allows owner bypass', () => {
    const owner = actor({ roles: ['owner'] });
    expect(policy.canWithContext(owner, 'unknown.action', 'x', {}).allowed).toBe(true);
  });

  // --- Reviewer context-aware status restrictions ---

  it('allows reviewer to set status to approved', () => {
    const r = actor({ roles: ['reviewer'] });
    expect(policy.canWithContext(r, 'task.updateStatus', 't1', { targetStatus: 'approved' }).allowed).toBe(true);
  });

  it('allows reviewer to set status to changes_requested', () => {
    const r = actor({ roles: ['reviewer'] });
    expect(policy.canWithContext(r, 'task.updateStatus', 't1', { targetStatus: 'changes_requested' }).allowed).toBe(true);
  });

  it('denies reviewer from setting status to in_progress', () => {
    const r = actor({ roles: ['reviewer'] });
    const result = policy.canWithContext(r, 'task.updateStatus', 't1', { targetStatus: 'in_progress' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Reviewer may only transition');
  });

  it('denies reviewer from setting status to todo', () => {
    const r = actor({ roles: ['reviewer'] });
    const result = policy.canWithContext(r, 'task.updateStatus', 't1', { targetStatus: 'todo' });
    expect(result.allowed).toBe(false);
  });

  it('allows builder to set status to in_progress (no reviewer limit)', () => {
    const b = actor({ roles: ['builder'] });
    expect(policy.canWithContext(b, 'task.updateStatus', 't1', { targetStatus: 'in_progress' }).allowed).toBe(true);
  });

  it('allows admin with reviewer role to set any status', () => {
    const a = actor({ roles: ['reviewer', 'admin'] });
    expect(policy.canWithContext(a, 'task.updateStatus', 't1', { targetStatus: 'in_progress' }).allowed).toBe(true);
  });

  it('allows maintainer with reviewer role to set any status', () => {
    const m = actor({ roles: ['reviewer', 'maintainer'] });
    expect(policy.canWithContext(m, 'task.updateStatus', 't1', { targetStatus: 'todo' }).allowed).toBe(true);
  });

  it('denies reviewer when no targetStatus context provided', () => {
    const r = actor({ roles: ['reviewer'] });
    const result = policy.canWithContext(r, 'task.updateStatus', 't1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('unknown');
  });
});

// --- Enforcement tests with real services (Task 4) ---

// Helper: create task with explicit meetingId to avoid auto-create-meeting
// (which requires manage_meetings capability). Uses 'workspace' as a
// no-op meeting id so task creation only checks task.create.
function createTaskInMeeting(ctx: MesaRuntimeContext, title: string) {
  return createTask(ctx, { title, meetingId: 'workspace' });
}

describe('Runtime context policy enforcement', () => {
  it('allow-all context permits task.delete for builder', () => {
    const ctx = makeAllowAllContext({ roles: ['builder'] });
    const task = createTaskInMeeting(ctx, 'Delete me');
    deleteTask(ctx, task.id);
  });

  it('role-based context denies task.delete for builder', () => {
    const ctx = makeRoleBasedContext({ roles: ['builder'] });
    const task = createTaskInMeeting(ctx, 'Cannot delete me');
    expect(() => deleteTask(ctx, task.id)).toThrow(PolicyDeniedError);
  });

  it('role-based context allows task.create for builder', () => {
    const ctx = makeRoleBasedContext({ roles: ['builder'] });
    const task = createTaskInMeeting(ctx, 'Normal task');
    expect(task.id).toBeDefined();
  });

  it('role-based context allows task.delete for owner', () => {
    const ctx = makeRoleBasedContext({ roles: ['owner'] });
    const task = createTaskInMeeting(ctx, 'Owner deletes');
    expect(() => deleteTask(ctx, task.id)).not.toThrow();
  });

  it('role-based context allows task.delete for admin', () => {
    const ctx = makeRoleBasedContext({ roles: ['admin'] });
    const task = createTaskInMeeting(ctx, 'Admin deletes');
    expect(() => deleteTask(ctx, task.id)).not.toThrow();
  });

  it('role-based context denies task.delete for connector', () => {
    const ctx = makeRoleBasedContext({ id: 'connector:github', type: 'ci', roles: ['connector'] });
    // Connector can't create tasks — must use same storage with owner to set up
    const setupCtx = createRuntimeContext({
      rootDir: ctx.rootDir,
      actor: { id: 'user:owner', type: 'user', roles: ['owner'] },
      storage: ctx.storage,
      policy: ctx.policy,
    });
    const task = createTaskInMeeting(setupCtx, 'Connector cannot delete');
    expect(() => deleteTask(ctx, task.id)).toThrow(PolicyDeniedError);
  });

  it('role-based context denies task.delete for ci', () => {
    const ctx = makeRoleBasedContext({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    const setupCtx = createRuntimeContext({
      rootDir: ctx.rootDir,
      actor: { id: 'user:owner', type: 'user', roles: ['owner'] },
      storage: ctx.storage,
      policy: ctx.policy,
    });
    const task = createTaskInMeeting(setupCtx, 'CI cannot delete');
    expect(() => deleteTask(ctx, task.id)).toThrow(PolicyDeniedError);
  });

  it('role-based context denies task.create for connector', () => {
    const ctx = makeRoleBasedContext({ id: 'connector:github', type: 'ci', roles: ['connector'] });
    expect(() => createTaskInMeeting(ctx, 'Connector create')).toThrow(PolicyDeniedError);
  });

  it('role-based context denies task.create for ci', () => {
    const ctx = makeRoleBasedContext({ id: 'ci:github', type: 'ci', roles: ['ci'] });
    expect(() => createTaskInMeeting(ctx, 'CI create')).toThrow(PolicyDeniedError);
  });

  it('allow-all context still permits everything (backward compat)', () => {
    const ctx = makeAllowAllContext({ roles: ['connector'] });
    const task = createTaskInMeeting(ctx, 'Compat test');
    expect(task.id).toBeDefined();
    deleteTask(ctx, task.id);
  });

  // --- Reviewer context-aware status enforcement ---

  it('role-based reviewer can set status to approved', () => {
    const ctx = makeRoleBasedContext({ roles: ['reviewer'] });
    const setupCtx = createRuntimeContext({
      rootDir: ctx.rootDir,
      actor: { id: 'user:owner', type: 'user', roles: ['owner'] },
      storage: ctx.storage,
      policy: ctx.policy,
    });
    const task = createTaskInMeeting(setupCtx, 'Reviewer approve');
    // Transition task through: todo -> in_progress -> ready_for_review -> reviewing (requires owner)
    updateTaskStatus(setupCtx, task.id, 'in_progress');
    updateTaskStatus(setupCtx, task.id, 'ready_for_review');
    updateTaskStatus(setupCtx, task.id, 'reviewing');
    expect(() => updateTaskStatus(ctx, task.id, 'approved')).not.toThrow();
  });

  it('role-based reviewer can set status to changes_requested', () => {
    const ctx = makeRoleBasedContext({ roles: ['reviewer'] });
    const setupCtx = createRuntimeContext({
      rootDir: ctx.rootDir,
      actor: { id: 'user:owner', type: 'user', roles: ['owner'] },
      storage: ctx.storage,
      policy: ctx.policy,
    });
    const task = createTaskInMeeting(setupCtx, 'Reviewer changes req');
    updateTaskStatus(setupCtx, task.id, 'in_progress');
    updateTaskStatus(setupCtx, task.id, 'ready_for_review');
    updateTaskStatus(setupCtx, task.id, 'reviewing');
    expect(() => updateTaskStatus(ctx, task.id, 'changes_requested')).not.toThrow();
  });

  it('role-based reviewer cannot set status to in_progress', () => {
    const ctx = makeRoleBasedContext({ roles: ['reviewer'] });
    const setupCtx = createRuntimeContext({
      rootDir: ctx.rootDir,
      actor: { id: 'user:owner', type: 'user', roles: ['owner'] },
      storage: ctx.storage,
      policy: ctx.policy,
    });
    const task = createTaskInMeeting(setupCtx, 'Reviewer blocked');
    updateTaskStatus(setupCtx, task.id, 'in_progress');
    updateTaskStatus(setupCtx, task.id, 'ready_for_review');
    updateTaskStatus(setupCtx, task.id, 'reviewing');
    expect(() => updateTaskStatus(ctx, task.id, 'in_progress')).toThrow(PolicyDeniedError);
  });

  it('role-based builder can set status to in_progress', () => {
    const ctx = makeRoleBasedContext({ roles: ['builder'] });
    const task = createTaskInMeeting(ctx, 'Builder progress');
    expect(() => updateTaskStatus(ctx, task.id, 'in_progress')).not.toThrow();
  });
});
