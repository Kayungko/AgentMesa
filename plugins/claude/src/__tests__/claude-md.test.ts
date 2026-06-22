import { describe, it, expect } from 'vitest';
import { generateClaudeMd } from '../generators/claude-md.js';

describe('generateClaudeMd', () => {
  it('should contain builder rules with real tool names', () => {
    const result = generateClaudeMd();
    expect(result).toContain('AgentMesa Builder Rules');
    expect(result).toContain('ready_for_review');
    expect(result).toContain('implementation_summary');
    expect(result).toContain('mesa_update_status');
    expect(result).toContain('mesa_attach_artifact');
    expect(result).toContain('mesa_request_review');
  });

  it('should contain fix rules with real tool names', () => {
    const result = generateClaudeMd();
    expect(result).toContain('AgentMesa Fix Rules');
    expect(result).toContain('fix_summary');
    expect(result).toContain('fix_done');
    expect(result).toContain('mesa_list_artifacts');
    expect(result).toContain('mesa_post_message');
  });

  it('should contain the MCP tools catalog', () => {
    const result = generateClaudeMd();
    expect(result).toContain('AgentMesa MCP Tools');
    expect(result).toContain('mesa_create_run');
    expect(result).toContain('mesa_exec_run');
    expect(result).toContain('mesa_request_handoff');
  });

  it('should not reference fictional tool names', () => {
    const result = generateClaudeMd();
    expect(result).not.toContain('mesa_task_update');
    expect(result).not.toContain('mesa_artifact_create');
    expect(result).not.toContain('mesa_artifact_read');
    expect(result).not.toContain('mesa_message_create');
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

  it('should include CLI quick reference with real subcommands', () => {
    const result = generateClaudeMd();
    expect(result).toContain('Mesa CLI Quick Reference');
    expect(result).toContain('mesa task list');
    expect(result).toContain('mesa task show');
    expect(result).toContain('mesa task status');
    expect(result).toContain('mesa runs exec');
    expect(result).toContain('mesa workflow run');
    expect(result).toContain('mesa meeting create');
    expect(result).toContain('mesa agent list');
    expect(result).not.toContain('mesa task get');
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
