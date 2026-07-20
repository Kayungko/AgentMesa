import { describe, it, expect } from 'vitest';
import { generateAgentsMd } from '../generators/agents-md.js';

describe('generateAgentsMd', () => {
  it('generates content with default options', () => {
    const result = generateAgentsMd();
    expect(result).toContain('# AgentMesa Project — Agent Definitions');
    expect(result).toContain('## Reviewer');
    expect(result).toContain('## Builder');
  });

  it('uses custom project name', () => {
    const result = generateAgentsMd({ projectName: 'My App' });
    expect(result).toContain('# My App — Agent Definitions');
    expect(result).not.toContain('AgentMesa Project');
  });

  it('uses custom reviewer agent name', () => {
    const result = generateAgentsMd({ reviewerAgent: 'CodeInspector' });
    expect(result).toContain('## CodeInspector');
    expect(result).not.toContain('## Reviewer\n');
  });

  it('uses custom builder agent name', () => {
    const result = generateAgentsMd({ builderAgent: 'Implementer' });
    expect(result).toContain('## Implementer');
    expect(result).not.toContain('## Builder\n');
  });

  it('includes reviewer rules for ready_for_review tasks', () => {
    const result = generateAgentsMd();
    expect(result).toContain('ready_for_review');
    expect(result).toContain('mesa_list_tasks');
    expect(result).toContain('mesa_read_task');
    expect(result).toContain('mesa_list_artifacts');
    expect(result).toContain('mesa_submit_review');
    expect(result).toContain('mesa_attach_artifact');
  });

  it('includes reviewer constraint: do not modify source code', () => {
    const result = generateAgentsMd();
    expect(result).toContain('Do NOT modify source code');
  });

  it('includes reviewer constraint: do not approve without reading diff', () => {
    const result = generateAgentsMd();
    expect(result).toContain('Do NOT approve without reading the diff');
  });

  it('includes builder rules', () => {
    const result = generateAgentsMd();
    expect(result).toContain('mesa_read_task');
    expect(result).toContain('implementation summary');
    expect(result).toContain('changed files');
    expect(result).toContain('ready_for_review');
  });

  it('uses the real mesa_update_status tool to transition tasks', () => {
    const result = generateAgentsMd();
    expect(result).toContain('mesa_update_status');
    expect(result).not.toContain('mesa_transition_task');
  });

  it('includes builder constraint: do not mark done before approval', () => {
    const result = generateAgentsMd();
    expect(result).toContain('Do NOT mark a task as done before it is approved');
  });

  it('includes the generated-by footer', () => {
    const result = generateAgentsMd();
    expect(result).toContain('@agentmesa/plugin-codex');
  });

  it('includes both approved and changes_requested verdicts', () => {
    const result = generateAgentsMd();
    expect(result).toContain('approved');
    expect(result).toContain('changes_requested');
  });

  it('uses all custom names together', () => {
    const result = generateAgentsMd({
      projectName: 'CoolProject',
      reviewerAgent: 'Auditor',
      builderAgent: 'Coder',
    });
    expect(result).toContain('# CoolProject');
    expect(result).toContain('## Auditor');
    expect(result).toContain('## Coder');
  });
});
