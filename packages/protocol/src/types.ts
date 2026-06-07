import type { TaskStatus } from './status.js';

export const mesaProtocolVersion = '0.1.0' as const;

// --- Agent ---

export type AgentRole =
  | 'chair'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'maintainer';

export interface MesaAgent {
  id: string;
  name: string;
  client: string;
  roles: AgentRole[];
}

export type PermissionLevel =
  | 'read_only'
  | 'reviewer'
  | 'builder'
  | 'maintainer'
  | 'owner';

export interface MesaAgentCapability {
  agentId: string;
  permissions: PermissionLevel[];
}

// --- Task ---

export interface TaskContext {
  goal?: string;
  changedFiles?: string[];
  commands?: string[];
}

export interface MesaTask {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  title: string;
  status: TaskStatus;
  createdBy: string;
  assignedTo?: string;
  reviewer?: string;
  meetingId?: string;
  branch?: string;
  context?: TaskContext;
  createdAt: string;
  updatedAt: string;
}

// --- Message ---

export type MessageType =
  | 'task_created'
  | 'handoff'
  | 'review_request'
  | 'review_result'
  | 'fix_request'
  | 'fix_done'
  | 'test_result'
  | 'decision'
  | 'status_changed';

export interface MesaMessage {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  taskId?: string;
  from: string;
  to?: string;
  type: MessageType;
  summary: string;
  artifactIds?: string[];
  createdAt: string;
}

// --- Artifact ---

export type ArtifactKind =
  | 'implementation_summary'
  | 'review_report'
  | 'fix_summary'
  | 'test_result'
  | 'git_diff'
  | 'patch'
  | 'decision_record'
  | 'pr_summary'
  | 'agent_run_log';

export interface MesaArtifact {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  kind: ArtifactKind;
  taskId?: string;
  createdBy: string;
  content: string;
  format?: 'markdown' | 'json' | 'diff' | 'text';
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// --- Meeting ---

export type MeetingStatus = 'open' | 'closed' | 'archived';

export interface MesaMeeting {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  title: string;
  status: MeetingStatus;
  tasks: string[];
  agents: string[];
  createdAt: string;
  updatedAt: string;
}
