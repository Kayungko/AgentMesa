import type { RoleCapability } from './types.js';

export function defineRoleCapabilities(): RoleCapability {
  return {
    chair: [
      'read_task',
      'write_task',
      'change_status',
      'post_message',
      'create_artifact',
      'modify_source',
      'run_command',
      'push_code',
      'merge_pr',
      'delete_task',
      'manage_agents',
      'manage_meetings',
    ],
    planner: [
      'read_task',
      'write_task',
      'post_message',
      'manage_meetings',
    ],
    builder: [
      'read_task',
      'write_task',
      'change_status',
      'post_message',
      'create_artifact',
      'modify_source',
      'run_command',
    ],
    reviewer: [
      'read_task',
      'post_message',
      'create_artifact',
      'change_status',
    ],
    tester: [
      'read_task',
      'post_message',
      'create_artifact',
      'run_command',
    ],
    documenter: [
      'read_task',
      'post_message',
      'create_artifact',
    ],
    maintainer: [
      'read_task',
      'write_task',
      'change_status',
      'post_message',
      'create_artifact',
      'run_command',
      'manage_agents',
      'manage_meetings',
      'delete_task',
    ],
  };
}
