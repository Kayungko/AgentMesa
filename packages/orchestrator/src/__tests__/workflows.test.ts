import { describe, it, expect } from 'vitest';
import { defineReviewFixLoop } from '../workflows/review-fix-loop.js';
import { defineFullTaskWorkflow } from '../workflows/full-task-workflow.js';

describe('defineReviewFixLoop', () => {
  const workflow = defineReviewFixLoop();

  it('should have correct id and metadata', () => {
    expect(workflow.id).toBe('review-fix-loop');
    expect(workflow.name).toBe('Review/Fix Loop');
    expect(workflow.description).toBeTruthy();
  });

  it('should have correct number of steps', () => {
    expect(workflow.steps).toHaveLength(7);
  });

  it('should have valid start step', () => {
    const startStep = workflow.steps.find((s) => s.id === workflow.startStep);
    expect(startStep).toBeDefined();
    expect(startStep?.type).toBe('update_status');
  });

  it('should include all required step types', () => {
    const types = workflow.steps.map((s) => s.type);
    expect(types).toContain('update_status');
    expect(types).toContain('run_agent');
    expect(types).toContain('check');
    expect(types).toContain('human_approval');
  });

  it('should have a check step with condition for max 3 cycles', () => {
    const checkStep = workflow.steps.find((s) => s.type === 'check');
    expect(checkStep).toBeDefined();
    expect(checkStep?.condition).toBeDefined();

    // Test condition: approved returns true
    const approvedContext = {
      taskId: 'test',
      workflowId: 'test',
      approved: true,
      reviewCycles: 0,
    };
    expect(checkStep?.condition!(approvedContext)).toBe(true);

    // Test condition: 3 cycles returns true
    const maxCyclesContext = {
      taskId: 'test',
      workflowId: 'test',
      approved: false,
      reviewCycles: 3,
    };
    expect(checkStep?.condition!(maxCyclesContext)).toBe(true);

    // Test condition: not approved and < 3 cycles returns false
    const continueContext = {
      taskId: 'test',
      workflowId: 'test',
      approved: false,
      reviewCycles: 1,
    };
    expect(checkStep?.condition!(continueContext)).toBe(false);
  });

  it('should have step-7 as the final step pointing to __end__', () => {
    const finalStep = workflow.steps.find((s) => s.id === 'step-7');
    expect(finalStep).toBeDefined();
    expect(finalStep?.onSuccess).toBe('__end__');
    expect(finalStep?.type).toBe('update_status');
  });
});

describe('defineFullTaskWorkflow', () => {
  const workflow = defineFullTaskWorkflow();

  it('should have correct id and metadata', () => {
    expect(workflow.id).toBe('full-task-workflow');
    expect(workflow.name).toBe('Full Task Workflow');
    expect(workflow.description).toBeTruthy();
  });

  it('should have correct number of steps', () => {
    expect(workflow.steps.length).toBeGreaterThanOrEqual(10);
  });

  it('should have valid start step', () => {
    const startStep = workflow.steps.find((s) => s.id === workflow.startStep);
    expect(startStep).toBeDefined();
  });

  it('should include plan, implement, review, test, document, approve steps', () => {
    const descriptions = workflow.steps.map((s) => s.description.toLowerCase());
    expect(descriptions.some((d) => d.includes('plan'))).toBe(true);
    expect(descriptions.some((d) => d.includes('implement'))).toBe(true);
    expect(descriptions.some((d) => d.includes('review'))).toBe(true);
    expect(descriptions.some((d) => d.includes('test'))).toBe(true);
    expect(descriptions.some((d) => d.includes('document'))).toBe(true);
    expect(descriptions.some((d) => d.includes('approve'))).toBe(true);
  });

  it('should end with a done step', () => {
    const doneStep = workflow.steps.find((s) => s.id === 'step-done');
    expect(doneStep).toBeDefined();
    expect(doneStep?.onSuccess).toBe('__end__');
  });
});
