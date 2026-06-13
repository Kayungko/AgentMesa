import { z } from 'zod';
import { currentProtocolVersion } from './version.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const protocolVersionSchema = z
  .enum(['0.1.0', '0.2.0'] as const)
  .default(currentProtocolVersion);

const agentRoleSchema = z.enum([
  'chair',
  'planner',
  'builder',
  'reviewer',
  'tester',
  'documenter',
  'maintainer',
  'researcher',
  'custom',
]);

const agentStatusSchema = z.enum(['available', 'busy', 'offline']);

const permissionLevelSchema = z.enum([
  'read_only',
  'reviewer',
  'builder',
  'maintainer',
  'owner',
]);

const messageTypeSchema = z.enum([
  'task_created',
  'handoff',
  'review_request',
  'review_result',
  'fix_request',
  'fix_done',
  'test_result',
  'decision',
  'status_changed',
  'task_assignment',
  'status_update',
  'review_feedback',
  'implementation_summary',
  'question',
  'answer',
  'general',
]);

const artifactKindSchema = z.enum([
  'implementation_summary',
  'review_report',
  'fix_summary',
  'test_result',
  'test_results',
  'git_diff',
  'patch',
  'decision_record',
  'pr_summary',
  'agent_run_log',
  'custom',
]);

const meetingStatusSchema = z.enum([
  'planning',
  'active',
  'paused',
  'completed',
  'archived',
  'open',
  'closed',
]);

const taskStatusSchema = z.enum([
  'backlog',
  'ready',
  'todo',
  'in_progress',
  'in_review',
  'needs_fix',
  'approved',
  'completed',
  'done',
  'blocked',
  'failed',
  'cancelled',
  'conflict',
  'needs_user_decision',
  'reviewing',
  'changes_requested',
  'ready_for_review',
]);

const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
const taskKindSchema = z.enum([
  'implement',
  'review',
  'fix',
  'test',
  'document',
  'research',
  'discuss',
]);

const threadResolutionSchema = z.enum(['unresolved', 'resolved', 'stale']);

export const eventTypeSchema = z.enum([
  'task_created',
  'task_status_changed',
  'task_assigned',
  'task_deleted',
  'meeting_created',
  'meeting_status_changed',
  'meeting_task_added',
  'meeting_agent_added',
  'agent_joined',
  'agent_left',
  'agent_registered',
  'message_sent',
  'artifact_created',
  'decision_made',
  'run_started',
  'run_completed',
  'check_completed',
  'thread_created',
  'thread_resolved',
]);

const transportKindSchema = z.enum(['file', 'mcp', 'http', 'websocket', 'github', 'ci']);

const clientTypeSchema = z.enum([
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'github',
  'ci',
  'other',
]);

const runActionSchema = z.enum([
  'implement',
  'review',
  'fix',
  'test',
  'document',
  'plan',
  'custom',
]);

const runStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

const checkResultStatusSchema = z.enum(['passed', 'failed', 'error', 'skipped']);
const checkKindSchema = z.enum(['test', 'lint', 'typecheck', 'security', 'custom']);

const repositoryTypeSchema = z.enum(['github', 'gitlab', 'bitbucket', 'none']);

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

// --- Agent ---

export const MesaAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  client: z.string().min(1),
  clientId: z.string().optional(),
  roles: z.array(agentRoleSchema).min(1),
  status: agentStatusSchema.default('available'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MesaAgentCapabilitySchema = z.object({
  agentId: z.string().min(1),
  permissions: z.array(permissionLevelSchema).min(1).default([]),
  supportedTransports: z.array(transportKindSchema).default([]),
  supportedArtifactKinds: z.array(artifactKindSchema).default([]),
  canReviewCode: z.boolean().default(false),
  canEditFiles: z.boolean().default(false),
  canRunShell: z.boolean().default(false),
  canUseMcp: z.boolean().default(false),
  canOpenPullRequest: z.boolean().default(false),
  canReadPullRequest: z.boolean().default(false),
  canExecuteCommands: z.array(z.string()).default([]),
  maxContextTokens: z.number().positive().optional(),
  allowedFilePatterns: z.array(z.string()).default([]),
  deniedFilePatterns: z.array(z.string()).default([]),
});

// --- Task ---

export const TaskContextSchema = z.object({
  goal: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
});

export const MesaTaskSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: taskStatusSchema,
  createdBy: z.string().min(1),
  assignedTo: z.string().optional(),
  assignedBuilder: z.string().optional(),
  reviewer: z.string().optional(),
  assignedReviewer: z.string().optional(),
  meetingId: z.string().min(1),
  branch: z.string().optional(),
  priority: taskPrioritySchema.default('normal'),
  kind: taskKindSchema.default('implement'),
  parentTaskId: z.string().optional(),
  context: TaskContextSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  closedAt: z.string().optional(),
});

// --- Message ---

export const MesaMessageSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  meetingId: z.string().optional(),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  from: z.string().min(1),
  senderAgentId: z.string().optional(),
  to: z.string().optional(),
  type: messageTypeSchema,
  summary: z.string().min(1),
  body: z.string().optional(),
  artifactIds: z.array(z.string()).optional(),
  createdAt: z.string().min(1),
});

// --- Artifact ---

export const MesaArtifactSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  meetingId: z.string().optional(),
  kind: artifactKindSchema,
  title: z.string().optional(),
  taskId: z.string().optional(),
  createdBy: z.string().min(1),
  producedByAgentId: z.string().optional(),
  content: z.string(),
  mimeType: z
    .enum([
      'text/markdown',
      'application/json',
      'text/x-diff',
      'text/plain',
      'application/vnd.agentmesa.patch+json',
    ])
    .default('text/markdown'),
  format: z.enum(['markdown', 'json', 'diff', 'text']).optional(),
  version: z.number().positive().default(1),
  parentArtifactId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().min(1),
});

// --- Meeting ---

export const MesaMeetingSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().optional(),
  status: meetingStatusSchema,
  workspaceId: z.string().optional(),
  ownerAgentId: z.string().optional(),
  tasks: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().optional(),
});

// --- Thread ---

export const MesaThreadSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  meetingId: z.string().min(1),
  title: z.string().min(1),
  rootMessageId: z.string().optional(),
  resolution: threadResolutionSchema.default('unresolved'),
  createdAt: z.string().min(1),
  resolvedAt: z.string().optional(),
});

// --- Decision ---

export const MesaDecisionSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  meetingId: z.string().min(1),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  decidedBy: z.string().min(1),
  title: z.string().optional(),
  options: z.array(z.string()).min(1),
  selectedOption: z.string().optional(),
  rationale: z.string().min(1).optional(),
  createdAt: z.string().min(1),
});

// --- Event ---

export const MesaEventSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  meetingId: z.string().min(1),
  type: eventTypeSchema,
  streamId: z.string().min(1),
  streamType: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
  actor: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
});

// --- Client ---

export const MesaClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: clientTypeSchema,
  supportedTransports: z.array(transportKindSchema).default([]),
  version: z.string().optional(),
  supportedFeatures: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// --- Transport ---

export const MesaTransportSchema = z.object({
  name: z.string().min(1),
  type: transportKindSchema,
  capabilities: z.array(z.string()).default([]),
  version: z.string().optional(),
});

// --- Agent Run ---

export const MesaAgentRunSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  taskId: z.string().optional(),
  meetingId: z.string().optional(),
  agentId: z.string().min(1),
  runnerType: z.string().optional(),
  action: runActionSchema.default('implement'),
  status: runStatusSchema.default('pending'),
  input: z.string().min(1),
  inputSummary: z.string().optional(),
  output: z.string().optional(),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
  producedArtifactIds: z.array(z.string()).default([]),
  startedAt: z.string().min(1),
  completedAt: z.string().optional(),
  duration: z.number().nonnegative().optional(),
});

// --- Check Result ---

export const MesaCheckResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().optional(),
  kind: checkKindSchema.default('test'),
  status: checkResultStatusSchema,
  checkName: z.string().min(1),
  exitCode: z.number().int().default(0),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  success: z.boolean(),
  summary: z.string().optional(),
  detail: z.string().optional(),
  createdAt: z.string().min(1),
});

// --- Repository ---

export const MesaRepositorySchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  type: repositoryTypeSchema.default('none'),
  url: z.string().optional(),
  remoteUrl: z.string().optional(),
  defaultBranch: z.string().default('main'),
  currentBranch: z.string().optional(),
  provider: z.string().optional(),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Input schemas (for create operations, without generated fields)
// ---------------------------------------------------------------------------

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  createdBy: z.string().min(1),
  assignedTo: z.string().optional(),
  assignedBuilder: z.string().optional(),
  reviewer: z.string().optional(),
  assignedReviewer: z.string().optional(),
  meetingId: z.string().min(1).optional(),
  branch: z.string().optional(),
  priority: taskPrioritySchema.default('normal'),
  kind: taskKindSchema.default('implement'),
  parentTaskId: z.string().optional(),
  context: TaskContextSchema.optional(),
});

export const CreateMessageInputSchema = z.object({
  meetingId: z.string().optional(),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  from: z.string().min(1),
  senderAgentId: z.string().optional(),
  to: z.string().optional(),
  type: messageTypeSchema,
  summary: z.string().min(1),
  body: z.string().optional(),
  artifactIds: z.array(z.string()).optional(),
});

export const CreateArtifactInputSchema = z.object({
  meetingId: z.string().optional(),
  kind: artifactKindSchema,
  title: z.string().optional(),
  taskId: z.string().optional(),
  createdBy: z.string().min(1),
  producedByAgentId: z.string().optional(),
  content: z.string(),
  mimeType: z
    .enum([
      'text/markdown',
      'application/json',
      'text/x-diff',
      'text/plain',
      'application/vnd.agentmesa.patch+json',
    ])
    .default('text/markdown'),
  format: z.enum(['markdown', 'json', 'diff', 'text']).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateMeetingInputSchema = z.object({
  title: z.string().min(1),
  purpose: z.string().optional(),
  tasks: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
});

export const CreateThreadInputSchema = z.object({
  meetingId: z.string().min(1),
  title: z.string().min(1),
  rootMessageId: z.string().optional(),
});

export const CreateDecisionInputSchema = z.object({
  meetingId: z.string().min(1),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  decidedBy: z.string().min(1),
  title: z.string().optional(),
  options: z.array(z.string()).min(1),
  selectedOption: z.string().optional(),
  rationale: z.string().optional(),
});

export const CreateAgentRunInputSchema = z.object({
  agentId: z.string().min(1),
  input: z.string().min(1),
  taskId: z.string().optional(),
  meetingId: z.string().optional(),
  runnerType: z.string().optional(),
  action: runActionSchema.default('implement'),
});

// ---------------------------------------------------------------------------
// Type inference (z.input for create operations, z.infer via types.ts)
// ---------------------------------------------------------------------------

export type MesaAgentInput = z.input<typeof MesaAgentSchema>;
export type MesaTaskInput = z.input<typeof MesaTaskSchema>;
export type MesaMessageInput = z.input<typeof MesaMessageSchema>;
export type MesaArtifactInput = z.input<typeof MesaArtifactSchema>;
export type MesaMeetingInput = z.input<typeof MesaMeetingSchema>;
export type MesaThreadInput = z.input<typeof MesaThreadSchema>;
export type MesaDecisionInput = z.input<typeof MesaDecisionSchema>;
export type MesaEventInput = z.input<typeof MesaEventSchema>;
export type MesaClientInput = z.input<typeof MesaClientSchema>;
export type MesaTransportInput = z.input<typeof MesaTransportSchema>;
export type MesaAgentRunInput = z.input<typeof MesaAgentRunSchema>;
export type MesaCheckResultInput = z.input<typeof MesaCheckResultSchema>;
export type MesaRepositoryInput = z.input<typeof MesaRepositorySchema>;
export type MesaAgentCapabilityInput = z.input<typeof MesaAgentCapabilitySchema>;

export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type CreateMessageInput = z.input<typeof CreateMessageInputSchema>;
export type CreateArtifactInput = z.input<typeof CreateArtifactInputSchema>;
export type CreateMeetingInput = z.input<typeof CreateMeetingInputSchema>;
export type CreateThreadInput = z.input<typeof CreateThreadInputSchema>;
export type CreateDecisionInput = z.input<typeof CreateDecisionInputSchema>;
export type CreateAgentRunInput = z.input<typeof CreateAgentRunInputSchema>;
