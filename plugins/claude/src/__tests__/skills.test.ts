import { describe, it, expect } from 'vitest';
import { generateSkillFiles } from '../generators/skills.js';

describe('generateSkillFiles', () => {
  it('should generate 4 skill files', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    expect(skills).toHaveLength(4);
  });

  it('should generate the meet skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const meetSkill = skills.find((s) => s.path.endsWith('agentmesa-meet.md'));
    expect(meetSkill).toBeDefined();
    expect(meetSkill!.path).toBe('.claude/skills/agentmesa-meet.md');
    expect(meetSkill!.content).toContain('mesa_meeting_create');
    expect(meetSkill!.content).toContain('mesa_meeting_add_agent');
  });

  it('should generate the handoff skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const handoffSkill = skills.find((s) => s.path.endsWith('agentmesa-handoff.md'));
    expect(handoffSkill).toBeDefined();
    expect(handoffSkill!.path).toBe('.claude/skills/agentmesa-handoff.md');
    expect(handoffSkill!.content).toContain('mesa_task_update');
    expect(handoffSkill!.content).toContain('handoff');
  });

  it('should generate the fix-from-review skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const fixSkill = skills.find((s) => s.path.endsWith('agentmesa-fix-from-review.md'));
    expect(fixSkill).toBeDefined();
    expect(fixSkill!.path).toBe('.claude/skills/agentmesa-fix-from-review.md');
    expect(fixSkill!.content).toContain('mesa_artifact_read');
    expect(fixSkill!.content).toContain('fix_summary');
    expect(fixSkill!.content).toContain('fix_done');
  });

  it('should generate the status skill', () => {
    const skills = generateSkillFiles({ outputDir: '.claude/skills' });
    const statusSkill = skills.find((s) => s.path.endsWith('agentmesa-status.md'));
    expect(statusSkill).toBeDefined();
    expect(statusSkill!.path).toBe('.claude/skills/agentmesa-status.md');
    expect(statusSkill!.content).toContain('mesa_task_get');
    expect(statusSkill!.content).toContain('status_changed');
  });

  it('should use custom outputDir in paths', () => {
    const skills = generateSkillFiles({ outputDir: 'custom/dir' });
    for (const skill of skills) {
      expect(skill.path).toMatch(/^custom\/dir\//);
    }
  });
});
