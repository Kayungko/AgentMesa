import type { TaskStatus } from './status.js';

export const mesaProtocolVersion = '0.1.0' as const;

export type AgentRole =
  | 'chair'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'maintainer';

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

export interface MesaAgent {
  id: string;
  name: string;
  client: string;
  roles: AgentRole[];
}

export interface MesaTask {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  title: string;
  status: TaskStatus;
  createdBy: string;
  assignedTo?: string;
  reviewer?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MesaMessage {
  protocolVersion: typeof mesaProtocolVersion;
  id: string;
  taskId?: string;
  from: string;
  to?: string;
  type: MessageType;
  summary: string;
  createdAt: string;
}
