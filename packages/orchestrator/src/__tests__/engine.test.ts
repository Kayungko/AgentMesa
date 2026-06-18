import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext, createTask, createWorkspacePaths } from '@agentmesa/core';
import type { MesaRuntimeContext, MesaActor } from '@agentmesa/core';
import { WorkflowEngine } from '../engine.js';
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
});
