import type { AgentRole } from '@agentmesa/protocol';

export type PolicyAction =
  | 'read_task'
  | 'write_task'
  | 'change_status'
  | 'post_message'
  | 'create_artifact'
  | 'modify_source'
  | 'run_command'
  | 'push_code'
  | 'merge_pr'
  | 'archive_task'
  | 'delete_task'
  | 'manage_agents'
  | 'manage_meetings'
  | 'read_events'
  | 'read_projections'
  | 'rebuild_projections'
  | 'inspect_transports';

export type RoleCapability = Record<AgentRole, PolicyAction[]>;

export interface FileAccessRule {
  pattern: string;
  allow: AgentRole[];
  deny?: AgentRole[];
}

export interface CommandPolicy {
  command: string;
  allow: boolean;
  requiresApproval?: boolean;
}

export interface AuditEntry {
  timestamp: string;
  agentId: string;
  action: string;
  resource: string;
  allowed: boolean;
  details?: string;
}
