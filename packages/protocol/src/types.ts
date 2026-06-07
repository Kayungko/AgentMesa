/**
 * AgentMesa Protocol Types
 *
 * ALL types are inferred from Zod schemas — schemas are the sole source of truth.
 * Enum-style literal unions are kept for convenience so consumers can use them
 * without pulling in Zod.
 */

import type {
  MesaAgentSchema,
  MesaAgentCapabilitySchema,
  MesaTaskSchema,
  MesaMessageSchema,
  MesaArtifactSchema,
  MesaMeetingSchema,
  MesaThreadSchema,
  MesaDecisionSchema,
  MesaEventSchema,
  MesaClientSchema,
  MesaTransportSchema,
  MesaAgentRunSchema,
  MesaCheckResultSchema,
  MesaRepositorySchema,
} from './schemas.js';

import type { z } from 'zod';

// --- Re-export protocol version from the version module ---
export { currentProtocolVersion } from './version.js';

// --- Enum-style literal unions ---

export type AgentRole =
  | 'chair'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'maintainer'
  | 'researcher'
  | 'custom';

export type AgentStatus = 'available' | 'busy' | 'offline';

export type PermissionLevel =
  | 'read_only'
  | 'reviewer'
  | 'builder'
  | 'maintainer'
  | 'owner';

export type MessageType =
  | 'task_created'
  | 'handoff'
  | 'review_request'
  | 'review_result'
  | 'fix_request'
  | 'fix_done'
  | 'test_result'
  | 'decision'
  | 'status_changed'
  | 'task_assignment'
  | 'status_update'
  | 'review_feedback'
  | 'implementation_summary'
  | 'question'
  | 'answer'
  | 'general';

export type ArtifactKind =
  | 'implementation_summary'
  | 'review_report'
  | 'fix_summary'
  | 'test_result'
  | 'test_results'
  | 'git_diff'
  | 'patch'
  | 'decision_record'
  | 'pr_summary'
  | 'agent_run_log'
  | 'custom';

export type MeetingStatus =
  | 'planning'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'open'
  | 'closed';

export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'needs_fix'
  | 'approved'
  | 'completed'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'conflict'
  | 'needs_user_decision'
  | 'reviewing'
  | 'changes_requested'
  | 'ready_for_review';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export type TaskKind =
  | 'implement'
  | 'review'
  | 'fix'
  | 'test'
  | 'document'
  | 'research'
  | 'discuss';

export type ThreadResolution = 'unresolved' | 'resolved' | 'stale';

export type EventType =
  | 'task_created'
  | 'task_status_changed'
  | 'task_assigned'
  | 'task_deleted'
  | 'meeting_created'
  | 'meeting_status_changed'
  | 'meeting_task_added'
  | 'meeting_agent_added'
  | 'agent_joined'
  | 'agent_left'
  | 'agent_registered'
  | 'message_sent'
  | 'artifact_created'
  | 'decision_made'
  | 'run_started'
  | 'run_completed'
  | 'check_completed'
  | 'thread_created'
  | 'thread_resolved';

export type TransportKind = 'file' | 'mcp' | 'http' | 'websocket' | 'github' | 'ci';

export type ClientType =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'github'
  | 'ci'
  | 'other';

export type RunAction = 'implement' | 'review' | 'fix' | 'test' | 'document' | 'plan' | 'custom';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CheckResultStatus = 'passed' | 'failed' | 'error' | 'skipped';

export type CheckKind = 'test' | 'lint' | 'typecheck' | 'security' | 'custom';

export type RepositoryType = 'github' | 'gitlab' | 'bitbucket' | 'none';

export type ArtifactMimeType =
  | 'text/markdown'
  | 'application/json'
  | 'text/x-diff'
  | 'text/plain'
  | 'application/vnd.agentmesa.patch+json';

// --- Entity types (inferred from schemas) ---

export type MesaAgent = z.infer<typeof MesaAgentSchema>;
export type MesaAgentCapability = z.infer<typeof MesaAgentCapabilitySchema>;
export type MesaTask = z.infer<typeof MesaTaskSchema>;
export type MesaMessage = z.infer<typeof MesaMessageSchema>;
export type MesaArtifact = z.infer<typeof MesaArtifactSchema>;
export type MesaMeeting = z.infer<typeof MesaMeetingSchema>;
export type MesaThread = z.infer<typeof MesaThreadSchema>;
export type MesaDecision = z.infer<typeof MesaDecisionSchema>;
export type MesaEvent = z.infer<typeof MesaEventSchema>;
export type MesaClient = z.infer<typeof MesaClientSchema>;
export type MesaTransport = z.infer<typeof MesaTransportSchema>;
export type MesaAgentRun = z.infer<typeof MesaAgentRunSchema>;
export type MesaCheckResult = z.infer<typeof MesaCheckResultSchema>;
export type MesaRepository = z.infer<typeof MesaRepositorySchema>;

// --- Deprecated: keep the old TaskContext interface for compatibility ---

export type TaskContext = NonNullable<MesaTask['context']>;
