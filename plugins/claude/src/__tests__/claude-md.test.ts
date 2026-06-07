import { describe, it, expect } from 'vitest';
import { generateClaudeMd } from '../generators/claude-md.js';

describe('generateClaudeMd', () => {
  it('should contain builder rules', () => {
    const result = generateClaudeMd();
    expect(result).toContain('AgentMesa Builder Rules');
    expect(result).toContain('ready_for_review');
    expect(result).toContain('implementation_summary');
    expect(result).toContain('review_request');
  });

  it('should contain fix rules', () => {
    const result = generateClaudeMd();
    expect(result).toContain('AgentMesa Fix Rules');
    expect(result).toContain('fix_summary');
    expect(result).toContain('fix_done');
  });

  it('should include task status when provided', () => {
    const result = generateClaudeMd({
      tasks: [
        { id: 'task-1', title: 'Add auth module', status: 'in_progress' },
        { id: 'task-2', title: 'Fix login bug', status: 'ready_for_review' },
      ],
    });
    expect(result).toContain('Current Tasks');
    expect(result).toContain('task-1');
    expect(result).toContain('Add auth module');
    expect(result).toContain('in_progress');
    expect(result).toContain('task-2');
    expect(result).toContain('ready_for_review');
  });

  it('should include agent list when provided', () => {
    const result = generateClaudeMd({
      agents: [
        { id: 'agent-1', name: 'BuilderBot', roles: ['builder'] },
        { id: 'agent-2', name: 'ReviewBot', roles: ['reviewer', 'chair'] },
      ],
    });
    expect(result).toContain('Available Agents');
    expect(result).toContain('BuilderBot');
    expect(result).toContain('builder');
    expect(result).toContain('ReviewBot');
    expect(result).toContain('reviewer');
    expect(result).toContain('chair');
  });

  it('should include CLI quick reference', () => {
    const result = generateClaudeMd();
    expect(result).toContain('Mesa CLI Quick Reference');
    expect(result).toContain('mesa task list');
    expect(result).toContain('mesa task get');
    expect(result).toContain('mesa meeting create');
    expect(result).toContain('mesa agent list');
  });

  it('should use projectName in the heading', () => {
    const result = generateClaudeMd({ projectName: 'MyApp' });
    expect(result).toContain('# MyApp');
  });

  it('should use default heading when no projectName given', () => {
    const result = generateClaudeMd();
    expect(result).toContain('# Project');
  });

  it('should not include tasks section when no tasks provided', () => {
    const result = generateClaudeMd();
    expect(result).not.toContain('Current Tasks');
  });

  it('should not include agents section when no agents provided', () => {
    const result = generateClaudeMd();
    expect(result).not.toContain('Available Agents');
  });
});
