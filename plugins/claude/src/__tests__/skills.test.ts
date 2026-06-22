import { describe, it, expect } from 'vitest';
import { generateSkillFiles } from '../generators/skills.js';

const FICTIONAL_TOOLS = [
  'mesa_task_update',
  'mesa_task_get',
  'mesa_artifact_create',
  'mesa_artifact_read',
  'mesa_message_create',
  'mesa_meeting_create',
  'mesa_meeting_add_agent',
];

describe('generateSkillFiles', () => {
  it('should generate 6 skill files', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    expect(skills).toHaveLength(6);
  });

  it('should generate the meet skill with real tool names', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const meet = skills.find((s) => s.path.endsWith('agentmesa-meet.md'));
    expect(meet).toBeDefined();
    expect(meet!.path).toBe('.claude/skills/agentmesa-meet.md');
    expect(meet!.content).toContain('mesa_create_meeting');
    expect(meet!.content).toContain('mesa_post_message');
  });

  it('should generate the handoff skill using the handoff loop tools', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const handoff = skills.find((s) => s.path.endsWith('agentmesa-handoff.md'));
    expect(handoff).toBeDefined();
    expect(handoff!.content).toContain('mesa_request_handoff');
    expect(handoff!.content).toContain('mesa_submit_handoff_result');
  });

  it('should generate the fix-from-review skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const fix = skills.find((s) => s.path.endsWith('agentmesa-fix-from-review.md'));
    expect(fix).toBeDefined();
    expect(fix!.content).toContain('mesa_list_artifacts');
    expect(fix!.content).toContain('mesa_attach_artifact');
    expect(fix!.content).toContain('fix_done');
  });

  it('should generate the status skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const status = skills.find((s) => s.path.endsWith('agentmesa-status.md'));
    expect(status).toBeDefined();
    expect(status!.content).toContain('mesa_read_task');
    expect(status!.content).toContain('mesa_update_status');
    expect(status!.content).toContain('status_changed');
  });

  it('should generate the run skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const run = skills.find((s) => s.path.endsWith('agentmesa-run.md'));
    expect(run).toBeDefined();
    expect(run!.content).toContain('mesa_create_run');
    expect(run!.content).toContain('mesa_exec_run');
  });

  it('should generate the review skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const review = skills.find((s) => s.path.endsWith('agentmesa-review.md'));
    expect(review).toBeDefined();
    expect(review!.content).toContain('mesa_list_tasks');
    expect(review!.content).toContain('mesa_submit_review');
  });

  it('should not reference any fictional tool names', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const all = skills.map((s) => s.content).join('\n');
    for (const name of FICTIONAL_TOOLS) {
      expect(all).not.toContain(name);
    }
  });

  it('should use custom outputDir in paths', () => {
    const skills = generateSkillFiles({ outputDir: 'custom/dir' });
    for (const skill of skills) {
      expect(skill.path).toMatch(/^custom\/dir\//);
    }
  });
});
