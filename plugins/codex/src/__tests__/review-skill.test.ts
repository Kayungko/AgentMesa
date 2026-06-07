import { describe, it, expect } from 'vitest';
import { generateReviewSkill } from '../generators/review-skill.js';

describe('generateReviewSkill', () => {
  it('returns a skill with the correct name', () => {
    const skill = generateReviewSkill();
    expect(skill.name).toBe('agentmesa-review');
  });

  it('returns a non-empty description', () => {
    const skill = generateReviewSkill();
    expect(skill.description).toContain('Review');
    expect(skill.description).toContain('AgentMesa');
  });

  it('includes step-by-step instructions with MCP tools', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('mesa_list_tasks');
    expect(skill.instructions).toContain('mesa_read_task');
    expect(skill.instructions).toContain('mesa_list_artifacts');
    expect(skill.instructions).toContain('mesa_submit_review');
    expect(skill.instructions).toContain('mesa_attach_artifact');
  });

  it('includes the step to find ready_for_review tasks', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('ready_for_review');
  });

  it('includes the step to get implementation summary', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('implementation_summary');
  });

  it('includes the step to get git diff', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('git_diff');
  });

  it('includes the review verdict options', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('approved');
    expect(skill.instructions).toContain('changes_requested');
  });

  it('uses default mesaDir when not specified', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('.mesa');
  });

  it('uses custom mesaDir when specified', () => {
    const skill = generateReviewSkill({ mesaDir: '/custom/workspace' });
    expect(skill.instructions).toContain('/custom/workspace');
    expect(skill.instructions).not.toContain('`.mesa`');
  });

  it('includes constraint: do not modify source code', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('Do NOT modify any source code');
  });

  it('includes the review_report artifact kind', () => {
    const skill = generateReviewSkill();
    expect(skill.instructions).toContain('review_report');
  });
});
