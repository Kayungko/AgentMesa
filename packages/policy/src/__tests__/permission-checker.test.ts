import { describe, it, expect } from 'vitest';
import type { AgentRole } from '@agentmesa/protocol';
import { PermissionChecker, PolicyError } from '../permission-checker.js';
import { defineRoleCapabilities } from '../role-capabilities.js';
import type { PolicyAction } from '../types.js';

const checker = new PermissionChecker();
const capabilities = defineRoleCapabilities();

describe('defineRoleCapabilities', () => {
  it('owner carries every PolicyAction, mirroring the core owner bypass', () => {
    // Core's RoleBasedPolicyEngine short-circuits owners to allow-all; this
    // table is what the runner permission bridge consults for Bash/Write
    // tool calls, so an owner without run_command would be denied there
    // while core allows — keep the two engines in lockstep.
    const allActions: PolicyAction[] = [
      'read_task',
      'write_task',
      'change_status',
      'post_message',
      'create_artifact',
      'modify_source',
      'run_command',
      'push_code',
      'merge_pr',
      'archive_task',
      'delete_task',
      'manage_agents',
      'manage_meetings',
      'read_events',
      'read_projections',
      'rebuild_projections',
      'inspect_transports',
      'manage_runs',
      'manage_workflows',
      'manage_rooms',
    ];
    expect(capabilities.owner).toHaveLength(allActions.length);
    for (const action of allActions) {
      expect(capabilities.owner).toContain(action);
      expect(checker.canPerform('owner', action)).toBe(true);
    }
  });

  it('chair has all 20 actions', () => {
    expect(capabilities.chair).toHaveLength(20);
    expect(capabilities.chair).toContain('read_task');
    expect(capabilities.chair).toContain('write_task');
    expect(capabilities.chair).toContain('change_status');
    expect(capabilities.chair).toContain('post_message');
    expect(capabilities.chair).toContain('create_artifact');
    expect(capabilities.chair).toContain('modify_source');
    expect(capabilities.chair).toContain('run_command');
    expect(capabilities.chair).toContain('push_code');
    expect(capabilities.chair).toContain('merge_pr');
    expect(capabilities.chair).toContain('archive_task');
    expect(capabilities.chair).toContain('delete_task');
    expect(capabilities.chair).toContain('manage_agents');
    expect(capabilities.chair).toContain('manage_meetings');
    expect(capabilities.chair).toContain('read_events');
    expect(capabilities.chair).toContain('read_projections');
    expect(capabilities.chair).toContain('rebuild_projections');
    expect(capabilities.chair).toContain('inspect_transports');
    expect(capabilities.chair).toContain('manage_runs');
    expect(capabilities.chair).toContain('manage_workflows');
    expect(capabilities.chair).toContain('manage_rooms');
  });

  it('planner has correct actions', () => {
    expect(capabilities.planner).toContain('read_task');
    expect(capabilities.planner).toContain('write_task');
    expect(capabilities.planner).toContain('post_message');
    expect(capabilities.planner).toContain('manage_meetings');
    expect(capabilities.planner).toContain('read_events');
    expect(capabilities.planner).toContain('read_projections');
    expect(capabilities.planner).not.toContain('push_code');
  });

  it('builder has correct actions', () => {
    expect(capabilities.builder).toContain('modify_source');
    expect(capabilities.builder).toContain('run_command');
    expect(capabilities.builder).toContain('create_artifact');
    expect(capabilities.builder).toContain('read_events');
    expect(capabilities.builder).toContain('read_projections');
    // Aligned with core: builder carries manage_agents / manage_meetings /
    // manage_rooms (the default MCP actor role must be able to register
    // itself and open meetings/rooms).
    expect(capabilities.builder).toContain('manage_agents');
    expect(capabilities.builder).toContain('manage_meetings');
    expect(capabilities.builder).toContain('manage_rooms');
    expect(capabilities.builder).not.toContain('push_code');
  });

  it('reviewer has correct actions', () => {
    expect(capabilities.reviewer).toContain('read_task');
    expect(capabilities.reviewer).toContain('post_message');
    expect(capabilities.reviewer).toContain('create_artifact');
    expect(capabilities.reviewer).toContain('change_status');
    expect(capabilities.reviewer).toContain('read_events');
    expect(capabilities.reviewer).toContain('read_projections');
    expect(capabilities.reviewer).not.toContain('modify_source');
    expect(capabilities.reviewer).not.toContain('run_command');
  });

  it('tester has correct actions', () => {
    expect(capabilities.tester).toContain('read_task');
    expect(capabilities.tester).toContain('post_message');
    expect(capabilities.tester).toContain('create_artifact');
    expect(capabilities.tester).toContain('run_command');
    expect(capabilities.tester).toContain('read_events');
    expect(capabilities.tester).toContain('read_projections');
    expect(capabilities.tester).not.toContain('modify_source');
    expect(capabilities.tester).not.toContain('write_task');
  });

  it('documenter has correct actions', () => {
    expect(capabilities.documenter).toContain('read_task');
    expect(capabilities.documenter).toContain('post_message');
    expect(capabilities.documenter).toContain('create_artifact');
    expect(capabilities.documenter).toContain('read_events');
    expect(capabilities.documenter).toContain('read_projections');
    expect(capabilities.documenter).not.toContain('modify_source');
  });

  it('maintainer has correct actions', () => {
    expect(capabilities.maintainer).toContain('manage_agents');
    expect(capabilities.maintainer).toContain('archive_task');
    expect(capabilities.maintainer).toContain('delete_task');
    expect(capabilities.maintainer).toContain('run_command');
    expect(capabilities.maintainer).toContain('read_events');
    expect(capabilities.maintainer).toContain('read_projections');
    expect(capabilities.maintainer).toContain('rebuild_projections');
    expect(capabilities.maintainer).toContain('inspect_transports');
    expect(capabilities.maintainer).not.toContain('push_code');
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
    const roles: AgentRole[] = ['owner', 'chair', 'planner', 'builder', 'reviewer', 'tester', 'documenter', 'maintainer', 'researcher', 'custom', 'admin', 'connector', 'ci', 'system'];
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
    expect(actions).toContain('read_task');
    expect(actions).toContain('post_message');
    expect(actions).toContain('create_artifact');
    expect(actions).toContain('read_events');
    expect(actions).toContain('read_projections');
    expect(actions).not.toContain('modify_source');
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
    expect(roles).toHaveLength(14);
  });

  it('returns roles that can manage_agents', () => {
    const roles = checker.getRolesForAction('manage_agents');
    expect(roles).toContain('owner');
    expect(roles).toContain('chair');
    expect(roles).toContain('maintainer');
    expect(roles).toContain('admin');
    // builder joins the list to match core (self-registration for the
    // default MCP actor role).
    expect(roles).toContain('builder');
    expect(roles).toHaveLength(5);
  });

  it('returns roles that can read_events', () => {
    const roles = checker.getRolesForAction('read_events');
    expect(roles).toContain('builder');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('connector');
    expect(roles).toContain('ci');
    expect(roles).toContain('system');
    expect(roles).not.toContain('custom');
  });

  it('returns roles that can read_projections', () => {
    const roles = checker.getRolesForAction('read_projections');
    expect(roles).toContain('builder');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('connector');
    expect(roles).toContain('ci');
    expect(roles).toContain('system');
    expect(roles).not.toContain('custom');
  });

  it('returns roles that can rebuild_projections', () => {
    const roles = checker.getRolesForAction('rebuild_projections');
    expect(roles).toContain('chair');
    expect(roles).toContain('maintainer');
    expect(roles).toContain('admin');
    expect(roles).toContain('system');
    expect(roles).not.toContain('builder');
    expect(roles).not.toContain('reviewer');
  });

  it('returns roles that can inspect_transports', () => {
    const roles = checker.getRolesForAction('inspect_transports');
    expect(roles).toContain('chair');
    expect(roles).toContain('maintainer');
    expect(roles).toContain('admin');
    expect(roles).not.toContain('builder');
    expect(roles).not.toContain('connector');
  });

  it('returns roles that can archive_task', () => {
    const roles = checker.getRolesForAction('archive_task');
    expect(roles).toContain('chair');
    expect(roles).toContain('maintainer');
    expect(roles).toContain('admin');
    expect(roles).not.toContain('builder');
    expect(roles).not.toContain('reviewer');
  });
});
