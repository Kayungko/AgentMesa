import { describe, it, expect } from 'vitest';
import type { AgentRole } from '@agentmesa/protocol';
import { PermissionChecker, PolicyError } from '../permission-checker.js';
import { defineRoleCapabilities } from '../role-capabilities.js';

const checker = new PermissionChecker();
const capabilities = defineRoleCapabilities();

describe('defineRoleCapabilities', () => {
  it('chair has all 12 actions', () => {
    expect(capabilities.chair).toHaveLength(12);
    expect(capabilities.chair).toContain('read_task');
    expect(capabilities.chair).toContain('write_task');
    expect(capabilities.chair).toContain('change_status');
    expect(capabilities.chair).toContain('post_message');
    expect(capabilities.chair).toContain('create_artifact');
    expect(capabilities.chair).toContain('modify_source');
    expect(capabilities.chair).toContain('run_command');
    expect(capabilities.chair).toContain('push_code');
    expect(capabilities.chair).toContain('merge_pr');
    expect(capabilities.chair).toContain('delete_task');
    expect(capabilities.chair).toContain('manage_agents');
    expect(capabilities.chair).toContain('manage_meetings');
  });

  it('planner has correct actions', () => {
    expect(capabilities.planner).toEqual([
      'read_task', 'write_task', 'post_message', 'manage_meetings',
    ]);
  });

  it('builder has correct actions', () => {
    expect(capabilities.builder).toContain('modify_source');
    expect(capabilities.builder).toContain('run_command');
    expect(capabilities.builder).toContain('create_artifact');
    expect(capabilities.builder).not.toContain('push_code');
    expect(capabilities.builder).not.toContain('manage_agents');
  });

  it('reviewer has correct actions', () => {
    expect(capabilities.reviewer).toContain('read_task');
    expect(capabilities.reviewer).toContain('post_message');
    expect(capabilities.reviewer).toContain('create_artifact');
    expect(capabilities.reviewer).toContain('change_status');
    expect(capabilities.reviewer).not.toContain('modify_source');
    expect(capabilities.reviewer).not.toContain('run_command');
  });

  it('tester has correct actions', () => {
    expect(capabilities.tester).toContain('read_task');
    expect(capabilities.tester).toContain('post_message');
    expect(capabilities.tester).toContain('create_artifact');
    expect(capabilities.tester).toContain('run_command');
    expect(capabilities.tester).not.toContain('modify_source');
    expect(capabilities.tester).not.toContain('write_task');
  });

  it('documenter has correct actions', () => {
    expect(capabilities.documenter).toEqual([
      'read_task', 'post_message', 'create_artifact',
    ]);
  });

  it('maintainer has correct actions', () => {
    expect(capabilities.maintainer).toContain('manage_agents');
    expect(capabilities.maintainer).toContain('delete_task');
    expect(capabilities.maintainer).toContain('run_command');
    expect(capabilities.maintainer).not.toContain('push_code');
    expect(capabilities.maintainer).not.toContain('merge_pr');
  });
});

describe('PermissionChecker.canPerform', () => {
  it('returns true for allowed actions', () => {
    expect(checker.canPerform('chair', 'push_code')).toBe(true);
    expect(checker.canPerform('builder', 'modify_source')).toBe(true);
    expect(checker.canPerform('tester', 'run_command')).toBe(true);
  });

  it('returns false for disallowed actions', () => {
    expect(checker.canPerform('documenter', 'modify_source')).toBe(false);
    expect(checker.canPerform('reviewer', 'run_command')).toBe(false);
    expect(checker.canPerform('planner', 'push_code')).toBe(false);
  });

  it('all roles can read tasks', () => {
    const roles: AgentRole[] = ['chair', 'planner', 'builder', 'reviewer', 'tester', 'documenter', 'maintainer'];
    for (const role of roles) {
      expect(checker.canPerform(role, 'read_task')).toBe(true);
    }
  });
});

describe('PermissionChecker.assertCanPerform', () => {
  it('does not throw for allowed actions', () => {
    expect(() => checker.assertCanPerform('chair', 'merge_pr')).not.toThrow();
    expect(() => checker.assertCanPerform('builder', 'modify_source')).not.toThrow();
  });

  it('throws PolicyError for unauthorized actions', () => {
    expect(() => checker.assertCanPerform('documenter', 'modify_source')).toThrow(PolicyError);
    expect(() => checker.assertCanPerform('reviewer', 'push_code')).toThrow(PolicyError);
  });

  it('PolicyError includes role and action in message', () => {
    try {
      checker.assertCanPerform('tester', 'merge_pr');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyError);
      expect((err as Error).message).toContain('tester');
      expect((err as Error).message).toContain('merge_pr');
    }
  });
});

describe('PermissionChecker.getActions', () => {
  it('returns actions for a role', () => {
    const actions = checker.getActions('documenter');
    expect(actions).toEqual(['read_task', 'post_message', 'create_artifact']);
  });

  it('returns empty array for unknown role', () => {
    const customChecker = new PermissionChecker({} as any);
    expect(customChecker.getActions('chair')).toEqual([]);
  });
});

describe('PermissionChecker.getRolesForAction', () => {
  it('returns roles that can push_code', () => {
    const roles = checker.getRolesForAction('push_code');
    expect(roles).toContain('chair');
    expect(roles).not.toContain('builder');
    expect(roles).not.toContain('reviewer');
  });

  it('returns roles that can read_task', () => {
    const roles = checker.getRolesForAction('read_task');
    expect(roles).toHaveLength(9);
  });

  it('returns roles that can manage_agents', () => {
    const roles = checker.getRolesForAction('manage_agents');
    expect(roles).toContain('chair');
    expect(roles).toContain('maintainer');
    expect(roles).toHaveLength(2);
  });
});
