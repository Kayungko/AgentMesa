import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  getTask,
  listAgentRuns,
} from '@agentmesa/core';
import type { MesaRuntimeContext, MesaActor } from '@agentmesa/core';
import { WorkflowEngine } from '../engine.js';
import { defineReviewFixLoop } from '../workflows/review-fix-loop.js';

const ORCHESTRATOR_ACTOR: MesaActor = { id: 'system:orchestrator', type: 'system', roles: ['owner'] };

let testDir: string;
let ctx: MesaRuntimeContext;
let engine: WorkflowEngine;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-wf-run-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({ rootDir: testDir, actor: ORCHESTRATOR_ACTOR });
  engine = new WorkflowEngine(ctx);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('review-fix-loop end-to-end', () => {
  it('drives from start and pauses at human_approval', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);

    state = await engine.advanceWorkflow(state);

    expect(state.status).toBe('waiting_approval');
    expect(state.currentStep).toBe('step-6');
    // Loop exhausted its 3 review cycles before requiring approval.
    expect(state.context.reviewCycles).toBeGreaterThanOrEqual(3);
  });

  it('dispatches real agent runs that complete', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);
    state = await engine.advanceWorkflow(state);

    const runs = listAgentRuns(ctx, { taskId: task.id });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status === 'completed')).toBe(true);
  });

  it('completes the workflow after approval', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);
    state = await engine.advanceWorkflow(state);
    expect(state.status).toBe('waiting_approval');

    state = engine.approve(state);
    state = await engine.advanceWorkflow(state);

    expect(state.status).toBe('completed');
    expect(state.currentStep).toBe('__end__');
    // Status updates applied the valid transitions (todo → in_progress →
    // ready_for_review); the final ready_for_review → done is not a valid
    // transition, so update_status tolerantly skips it and the task stays at
    // ready_for_review without failing the workflow.
    expect(getTask(ctx, task.id).status).toBe('ready_for_review');
  });

  it('does not fail on idempotent / invalid status transitions during the loop', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);
    state = await engine.advanceWorkflow(state);

    // Re-entering ready_for_review repeatedly across cycles never aborts.
    expect(state.status).not.toBe('failed');
    const skipped = state.history.filter(
      (h) => h.result && typeof h.result === 'object' && 'skipped' in (h.result as object),
    );
    expect(skipped.length).toBeGreaterThan(0);
  });
});
