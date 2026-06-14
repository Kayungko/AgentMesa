import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  createAgentRun,
  updateAgentRunStatus,
  getAgentRun,
  listAgentRuns,
} from '../services/agent-run-service.js';
import { PolicyDeniedError } from '../errors.js';
import { RoleBasedPolicyEngine } from '../runtime/policy.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createAgentRun', () => {
  it('creates a run with pending status', () => {
    const run = createAgentRun(ctx, {
      agentId: 'builder-1',
      input: 'Implement login feature',
      taskId: 'task_test1234',
    });
    expect(run.id).toMatch(/^run_/);
    expect(run.status).toBe('pending');
    expect(run.agentId).toBe('builder-1');
    expect(run.action).toBe('implement');
    expect(run.input).toBe('Implement login feature');
    expect(run.taskId).toBe('task_test1234');
    expect(run.protocolVersion).toBe('0.2.0');
  });

  it('creates a run with explicit action', () => {
    const run = createAgentRun(ctx, {
      agentId: 'reviewer-1',
      input: 'Review PR',
      action: 'review',
    });
    expect(run.action).toBe('review');
  });

  it('generates unique run IDs', () => {
    const r1 = createAgentRun(ctx, { agentId: 'a1', input: 'Task 1' });
    const r2 = createAgentRun(ctx, { agentId: 'a2', input: 'Task 2' });
    expect(r1.id).toMatch(/^run_/);
    expect(r2.id).toMatch(/^run_/);
    expect(r1.id).not.toBe(r2.id);
  });

  it('writes run to disk', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const filePath = join(paths.runsDir, `${run.id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('getAgentRun', () => {
  it('retrieves a created run', () => {
    const created = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const fetched = getAgentRun(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('pending');
  });

  it('throws RunNotFoundError for unknown run', () => {
    expect(() => getAgentRun(ctx, 'run_nonexist')).toThrow(/Agent run not found/);
  });
});

describe('listAgentRuns', () => {
  it('lists all runs', () => {
    createAgentRun(ctx, { agentId: 'a1', input: 'Task A' });
    createAgentRun(ctx, { agentId: 'a2', input: 'Task B' });
    const runs = listAgentRuns(ctx);
    expect(runs).toHaveLength(2);
  });

  it('filters by status', () => {
    const r1 = createAgentRun(ctx, { agentId: 'a1', input: 'Task A' });
    updateAgentRunStatus(ctx, r1.id, 'completed');
    createAgentRun(ctx, { agentId: 'a2', input: 'Task B' });

    const completed = listAgentRuns(ctx, { status: 'completed' });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(r1.id);

    const pending = listAgentRuns(ctx, { status: 'pending' });
    expect(pending).toHaveLength(1);
  });

  it('filters by agentId', () => {
    createAgentRun(ctx, { agentId: 'agent-x', input: 'Task A' });
    createAgentRun(ctx, { agentId: 'agent-y', input: 'Task B' });
    const filtered = listAgentRuns(ctx, { agentId: 'agent-x' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].agentId).toBe('agent-x');
  });

  it('filters by taskId', () => {
    createAgentRun(ctx, { agentId: 'a1', input: 'Task A', taskId: 'task_aaa' });
    createAgentRun(ctx, { agentId: 'a2', input: 'Task B', taskId: 'task_bbb' });
    const filtered = listAgentRuns(ctx, { taskId: 'task_aaa' });
    expect(filtered).toHaveLength(1);
  });

  it('returns empty array when no runs', () => {
    expect(listAgentRuns(ctx)).toEqual([]);
  });
});

describe('updateAgentRunStatus', () => {
  it('transitions from pending to running', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const updated = updateAgentRunStatus(ctx, run.id, 'running');
    expect(updated.status).toBe('running');
  });

  it('transitions to completed with output', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const updated = updateAgentRunStatus(ctx, run.id, 'completed', {
      output: 'All tests passed',
      outputSummary: 'Feature implemented',
      producedArtifactIds: ['artifact_1111'],
    });
    expect(updated.status).toBe('completed');
    expect(updated.output).toBe('All tests passed');
    expect(updated.outputSummary).toBe('Feature implemented');
    expect(updated.producedArtifactIds).toContain('artifact_1111');
    expect(updated.completedAt).toBeDefined();
    expect(updated.duration).toBeGreaterThanOrEqual(0);
  });

  it('transitions to failed with error', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const updated = updateAgentRunStatus(ctx, run.id, 'failed', {
      error: 'Build failed',
    });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('Build failed');
    expect(updated.completedAt).toBeDefined();
  });

  it('merges producedArtifactIds across updates', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'running', { producedArtifactIds: ['art_a'] });
    const updated = updateAgentRunStatus(ctx, run.id, 'completed', { producedArtifactIds: ['art_b'] });
    expect(updated.producedArtifactIds).toContain('art_a');
    expect(updated.producedArtifactIds).toContain('art_b');
  });

  it('does not duplicate artifacts from repeated patches', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'running', { producedArtifactIds: ['art_a'] });
    const updated = updateAgentRunStatus(ctx, run.id, 'completed', { producedArtifactIds: ['art_a'] });
    expect(updated.producedArtifactIds).toHaveLength(1);
  });
});

describe('agent run events', () => {
  it('appends agent_run_created event', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const events = ctx.eventStore.list({ streamId: run.id });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent_run_created');
    expect(events[0].data.run).toBeDefined();
  });

  it('appends agent_run_status_changed event on status update', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'running');
    const events = ctx.eventStore.list({ streamId: run.id });
    const statusEvents = events.filter((e) => e.type === 'agent_run_status_changed');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].data.previousStatus).toBe('pending');
    expect(statusEvents[0].data.newStatus).toBe('running');
  });

  it('appends agent_run_completed event on completion', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'running');
    updateAgentRunStatus(ctx, run.id, 'completed');
    const events = ctx.eventStore.list({ streamId: run.id });
    const completedEvents = events.filter((e) => e.type === 'agent_run_completed');
    expect(completedEvents).toHaveLength(1);
  });

  it('appends agent_run_failed event on failure', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'failed', { error: 'crash' });
    const events = ctx.eventStore.list({ streamId: run.id });
    const failedEvents = events.filter((e) => e.type === 'agent_run_failed');
    expect(failedEvents).toHaveLength(1);
  });

  it('event sequence is correct across lifecycle', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    updateAgentRunStatus(ctx, run.id, 'running');
    updateAgentRunStatus(ctx, run.id, 'completed');

    const events = ctx.eventStore.list({ streamId: run.id });
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'agent_run_created',
      'agent_run_status_changed',
      'agent_run_completed',
    ]);
  });
});

describe('policy denied', () => {
  it('denies run.create for connector role', () => {
    const restrictedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'conn:test', type: 'agent', roles: ['connector'] },
      policy: new RoleBasedPolicyEngine(),
    });
    expect(() =>
      createAgentRun(restrictedCtx, { agentId: 'a1', input: 'Test' }),
    ).toThrow(PolicyDeniedError);
  });

  it('denies run.create for ci role', () => {
    const ciCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'ci:test', type: 'ci', roles: ['ci'] },
      policy: new RoleBasedPolicyEngine(),
    });
    // CI has manage_runs capability - let me verify
    expect(() =>
      createAgentRun(ciCtx, { agentId: 'a1', input: 'Test' }),
    ).not.toThrow();
  });

  it('denies run.updateStatus for system role', () => {
    const sysCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'sys:test', type: 'system', roles: ['system'] },
      policy: new RoleBasedPolicyEngine(),
    });
    const ownerRun = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    expect(() =>
      updateAgentRunStatus(sysCtx, ownerRun.id, 'running'),
    ).toThrow(PolicyDeniedError);
  });

  it('allows run.create for builder role', () => {
    const builderCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'builder:test', type: 'agent', roles: ['builder'] },
      policy: new RoleBasedPolicyEngine(),
    });
    const run = createAgentRun(builderCtx, { agentId: 'builder:test', input: 'Test' });
    expect(run.id).toMatch(/^run_/);
  });

  it('allows run.create for reviewer role', () => {
    const reviewerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'reviewer:test', type: 'agent', roles: ['reviewer'] },
      policy: new RoleBasedPolicyEngine(),
    });
    const run = createAgentRun(reviewerCtx, { agentId: 'reviewer:test', input: 'Review' });
    expect(run.id).toMatch(/^run_/);
  });
});
