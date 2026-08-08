import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext, createTask, createWorkspacePaths, listEvents } from '@agentmesa/core';
import type { MesaRuntimeContext, MesaActor } from '@agentmesa/core';
import { WorkflowEngine, decideWorkflow, listWorkflowStates } from '../engine.js';
import { defineReviewFixLoop } from '../workflows/review-fix-loop.js';

const ORCHESTRATOR_ACTOR: MesaActor = { id: 'system:orchestrator', type: 'system', roles: ['owner'] };

describe('WorkflowEngine', () => {
  let tempDir: string;
  let ctx: MesaRuntimeContext;
  let engine: WorkflowEngine;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
    initWorkspace(tempDir);
    ctx = createRuntimeContext({ rootDir: tempDir, actor: ORCHESTRATOR_ACTOR });
    engine = new WorkflowEngine(ctx);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('startWorkflow', () => {
    it('should create workflow state with correct initial values', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      expect(state.workflowId).toBeTruthy();
      expect(state.workflowDefinitionId).toBe('review-fix-loop');
      expect(state.currentStep).toBe('step-1');
      expect(state.status).toBe('running');
      expect(state.taskId).toBe('task-123');
      expect(state.history).toEqual([]);
      expect(state.startedAt).toBeTruthy();
    });

    it('should set context with taskId and workflowId', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-456');

      expect(state.context.taskId).toBe('task-456');
      expect(state.context.workflowId).toBe(state.workflowId);
      expect(state.context.reviewCycles).toBe(0);
    });
  });

  describe('executeStep', () => {
    it('should advance step and add to history', async () => {
      const definition = defineReviewFixLoop();
      const task = createTask(ctx, { title: 'Advance test' });
      const state = engine.startWorkflow(definition, task.id);

      const result = await engine.executeStep(state);

      expect(result.history).toHaveLength(1);
      expect(result.history[0]!.stepId).toBe('step-1');
      expect(result.history[0]!.status).toBe('completed');
      expect(result.currentStep).toBe('step-2');
    });

    it('should throw if workflow is not running', async () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');
      engine.pause(state);

      await expect(engine.executeStep(state)).rejects.toThrow(
        /Cannot execute step/
      );
    });

    it('should complete workflow when current step is __end__', async () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');
      state.currentStep = '__end__';

      const result = await engine.executeStep(state);

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeTruthy();
    });
  });

  describe('human approval', () => {
    async function createWaitingWorkflow() {
      const definition = {
        id: 'full-task-workflow',
        name: 'Approval test',
        description: 'Approval test',
        startStep: 'step-approve',
        steps: [
          {
            id: 'step-approve',
            type: 'human_approval' as const,
            description: 'Approve delivery',
            onSuccess: 'step-done',
          },
          {
            id: 'step-done',
            type: 'wait' as const,
            description: 'Finish',
            onSuccess: '__end__',
          },
        ],
      };
      const state = engine.startWorkflow(definition, 'task-approval');
      await engine.executeStep(state);
      return state;
    }

    it('persists waiting and approved events', async () => {
      const state = await createWaitingWorkflow();
      expect(state.status).toBe('waiting_approval');
      expect(state.history.at(-1)?.status).toBe('running');

      const approved = decideWorkflow(ctx, state.workflowId, {
        decision: 'approve',
        message: 'Ship after updating the changelog',
      });

      expect(approved.status).toBe('running');
      expect(approved.currentStep).toBe('step-done');
      expect(approved.history.at(-1)?.status).toBe('completed');
      expect(approved.context.metadata?.['approvalContext']).toEqual({
        approvalStepId: 'step-approve',
        targetStepId: 'step-done',
        message: 'Ship after updating the changelog',
      });
      const reloaded = new WorkflowEngine(ctx).loadState(state.workflowId);
      expect(reloaded?.currentStep).toBe('step-done');
      expect(listEvents(ctx, { streamId: state.workflowId }).map((event) => event.type)).toEqual([
        'workflow_waiting_approval',
        'workflow_approved',
      ]);
    });

    it('persists rejection and emits a rejected event', async () => {
      const state = await createWaitingWorkflow();
      const rejected = decideWorkflow(ctx, state.workflowId, {
        decision: 'reject',
        reason: 'Needs another review',
      });

      expect(rejected.status).toBe('failed');
      expect(rejected.history).toHaveLength(1);
      expect(rejected.history.at(-1)?.status).toBe('failed');
      expect(rejected.history.at(-1)?.error).toBe('Needs another review');
      expect(listEvents(ctx, { streamId: state.workflowId }).at(-1)?.type).toBe('workflow_rejected');
    });

    it('denies workflow decisions for read-only actors', async () => {
      const state = await createWaitingWorkflow();
      const readOnly = createRuntimeContext({
        rootDir: tempDir,
        actor: { id: 'viewer', type: 'user', roles: ['read_only'] },
      });

      expect(() => decideWorkflow(readOnly, state.workflowId, { decision: 'approve' })).toThrow('Policy denied');
    });
  });

  describe('pause', () => {
    it('should set status to paused', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      const result = engine.pause(state);

      expect(result.status).toBe('paused');
      expect(result.pausedAt).toBeTruthy();
    });

    it('should throw if workflow is not running', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');
      engine.pause(state);

      expect(() => engine.pause(state)).toThrow(/Cannot pause/);
    });
  });

  describe('resume', () => {
    it('should continue from paused state', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');
      engine.pause(state);

      const result = engine.resume(state);

      expect(result.status).toBe('running');
      expect(result.resumedAt).toBeTruthy();
    });

    it('should throw if workflow is not paused', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      expect(() => engine.resume(state)).toThrow(/Cannot resume/);
    });
  });

  describe('abort', () => {
    it('should set status to failed with reason', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      const result = engine.abort(state, 'User cancelled');

      expect(result.status).toBe('failed');
      expect(result.completedAt).toBeTruthy();
      expect(result.history).toHaveLength(1);
      expect(result.history[0]!.error).toBe('User cancelled');
    });
  });

  describe('saveState', () => {
    it('should persist state to file', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');
      const paths = createWorkspacePaths(tempDir);

      const filePath = join(paths.logsDir, 'workflows', `${state.workflowId}.json`);
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('loadState', () => {
    it('should read state from file', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      // Create a new engine to ensure it loads from file
      const newEngine = new WorkflowEngine(
        createRuntimeContext({ rootDir: tempDir, actor: ORCHESTRATOR_ACTOR }),
      );

      const loaded = newEngine.loadState(state.workflowId);

      expect(loaded).not.toBeNull();
      expect(loaded!.workflowId).toBe(state.workflowId);
      expect(loaded!.taskId).toBe('task-123');
    });

    it('should return null for non-existent workflow', () => {
      const loaded = engine.loadState('non-existent-id');
      expect(loaded).toBeNull();
    });
  });

  describe('getState', () => {
    it('should return state from cache first', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      const retrieved = engine.getState(state.workflowId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.workflowId).toBe(state.workflowId);
    });

    it('should fall back to loading from file', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      // Create new engine (no cache)
      const newEngine = new WorkflowEngine(
        createRuntimeContext({ rootDir: tempDir, actor: ORCHESTRATOR_ACTOR }),
      );

      const retrieved = newEngine.getState(state.workflowId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.workflowId).toBe(state.workflowId);
    });

    it('should return null for unknown workflow', () => {
      const retrieved = engine.getState('unknown-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('listWorkflowStates', () => {
    it('returns an empty array when no workflows have run', () => {
      expect(listWorkflowStates(ctx)).toEqual([]);
    });

    it('lists a started workflow', () => {
      const definition = defineReviewFixLoop();
      const state = engine.startWorkflow(definition, 'task-123');

      const states = listWorkflowStates(ctx);
      expect(states).toHaveLength(1);
      expect(states[0]!.workflowId).toBe(state.workflowId);
      expect(states[0]!.taskId).toBe('task-123');
    });

    it('sorts multiple workflows newest first', async () => {
      const definition = defineReviewFixLoop();
      const first = engine.startWorkflow(definition, 'task-first');
      await new Promise((r) => setTimeout(r, 5));
      const second = engine.startWorkflow(definition, 'task-second');

      const states = listWorkflowStates(ctx);
      expect(states).toHaveLength(2);
      expect(states[0]!.workflowId).toBe(second.workflowId);
      expect(states[1]!.workflowId).toBe(first.workflowId);
    });
  });
});
