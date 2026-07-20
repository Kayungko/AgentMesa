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
  updateTaskStatus,
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
    expect(state.currentStep).toBe('step-7');
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
    // ready_for_review → reviewing); no real reviewer backend is configured
    // in this stub/test environment, so no mesa_submit_review call ever
    // moves the task past reviewing, and the final reviewing → done is not
    // a valid transition — update_status tolerantly skips it and the task
    // stays at reviewing without failing the workflow.
    expect(getTask(ctx, task.id).status).toBe('reviewing');
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

describe('review-fix-loop real verdict sync', () => {
  it('passes the check step immediately when mesa_submit_review already approved the task', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);

    state = await engine.executeStep(state); // step-1: in_progress
    state = await engine.executeStep(state); // step-2: run_agent builder
    state = await engine.executeStep(state); // step-3: ready_for_review
    state = await engine.executeStep(state); // step-4: reviewing

    // Simulate the reviewer's CLI session having already called
    // mesa_submit_review(verdict: 'approved') via MCP during that run.
    updateTaskStatus(ctx, task.id, 'approved');

    state = await engine.executeStep(state); // step-5: run_agent reviewer
    expect(state.context.approved).toBe(true);
    expect(state.context.changesRequested).toBe(false);

    state = await engine.executeStep(state); // step-6: check
    expect(state.currentStep).toBe('step-7');
    expect(state.context.reviewCycles ?? 0).toBe(0);
  });

  it('loops back to the builder when mesa_submit_review requested changes', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    let state = engine.startWorkflow(defineReviewFixLoop(), task.id);

    state = await engine.executeStep(state); // step-1: in_progress
    state = await engine.executeStep(state); // step-2: run_agent builder
    state = await engine.executeStep(state); // step-3: ready_for_review
    state = await engine.executeStep(state); // step-4: reviewing

    updateTaskStatus(ctx, task.id, 'changes_requested');

    state = await engine.executeStep(state); // step-5: run_agent reviewer
    expect(state.context.approved).toBe(false);
    expect(state.context.changesRequested).toBe(true);

    state = await engine.executeStep(state); // step-6: check
    expect(state.currentStep).toBe('step-2');
    expect(state.context.reviewCycles).toBe(1);
  });
});
