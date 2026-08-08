import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  createAgentRun,
  getAgentRun,
  updateAgentRunStatus,
  listEvents,
  listArtifacts,
  RunNotFoundError,
  MesaError,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeRun, resolveRunnerType } from '../run-executor.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-run-exec-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('resolveRunnerType', () => {
  it('uses explicit runnerType when valid', () => {
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'echo hi', taskId: task.id, runnerType: 'shell-check' });
    expect(resolveRunnerType(run)).toBe('shell-check');
  });

  it('maps action to a default backend when no runnerType', () => {
    const task = createTask(ctx, { title: 'T' });
    const review = createAgentRun(ctx, { agentId: 'a1', input: 'x', taskId: task.id, action: 'review' });
    expect(resolveRunnerType(review)).toBe('codex-review');
    const fix = createAgentRun(ctx, { agentId: 'a1', input: 'x', taskId: task.id, action: 'fix' });
    expect(resolveRunnerType(fix)).toBe('claude-fix');
    const impl = createAgentRun(ctx, { agentId: 'a1', input: 'x', taskId: task.id, action: 'implement' });
    expect(resolveRunnerType(impl)).toBe('claude-implement');
  });
});

describe('executeRun', () => {
  it('drives a dry-run implement run to completed without creating an artifact', async () => {
    const task = createTask(ctx, { title: 'Implement login' });
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Build it', taskId: task.id, action: 'implement' });

    const progress: string[] = [];
    const { run: final } = await executeRun(ctx, run.id, {
      dryRun: true,
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(final.status).toBe('completed');
    expect(progress).toEqual(['started', 'runner_invoked', 'completed']);

    const events = listEvents(ctx, { streamId: run.id }).map((e) => e.type);
    expect(events).toContain('agent_run_status_changed');
    expect(events).toContain('agent_run_progress');
    expect(events).toContain('agent_run_completed');

    expect(listArtifacts(ctx, undefined, 'agent_run_log')).toHaveLength(0);
    expect(final.producedArtifactIds).toHaveLength(0);
  });

  it('persists an agent_run_log artifact on a non-dry success', async () => {
    const task = createTask(ctx, { title: 'Implement signup' });
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Build it', taskId: task.id, action: 'implement' });

    const { run: final } = await executeRun(ctx, run.id, { dryRun: false });

    expect(final.status).toBe('completed');
    expect(final.producedArtifactIds).toHaveLength(1);
    expect(final.output).toBeTruthy();
    expect(final.outputSummary).toBeTruthy();

    const artifacts = listArtifacts(ctx, undefined, 'agent_run_log');
    expect(artifacts).toHaveLength(1);
    expect(final.producedArtifactIds[0]).toBe(artifacts[0]!.id);
  });

  it('throws RunNotFoundError for an unknown run id', async () => {
    await expect(executeRun(ctx, 'run_nope')).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('throws VALIDATION_ERROR when the run is not pending', async () => {
    const task = createTask(ctx, { title: 'Already done' });
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'x', taskId: task.id });
    updateAgentRunStatus(ctx, run.id, 'running');
    updateAgentRunStatus(ctx, run.id, 'completed');

    await expect(executeRun(ctx, run.id)).rejects.toBeInstanceOf(MesaError);
  });

  it('marks the run failed and rethrows when the backend throws', async () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'x', taskId: 'task_missing', action: 'implement' });
    const progress: string[] = [];

    await expect(executeRun(ctx, run.id, {
      onProgress: (event) => {
        progress.push(event.stage);
      },
    })).rejects.toThrow();

    const after = getAgentRun(ctx, run.id);
    expect(after.status).toBe('failed');
    expect(after.error).toBeTruthy();
    expect(progress).toEqual(['started', 'runner_invoked', 'failed']);
  });

  it('continues after a progress sink failure because progress is already persisted', async () => {
    const task = createTask(ctx, { title: 'Progress sink failure' });
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Build it', taskId: task.id });

    const { run: final } = await executeRun(ctx, run.id, {
      dryRun: true,
      onProgress: () => {
        throw new Error('disconnected');
      },
    });

    expect(final.status).toBe('completed');
    expect(listEvents(ctx, { streamId: run.id }).filter((event) => event.type === 'agent_run_progress')).toHaveLength(3);
  });
});
