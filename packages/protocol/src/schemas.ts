import { z } from 'zod';
import { mesaProtocolVersion } from './types.js';

// --- Primitives ---

const protocolVersionSchema = z.literal(mesaProtocolVersion).default(mesaProtocolVersion);

const agentRoleSchema = z.enum([
  'chair',
  'planner',
  'builder',
  'reviewer',
  'tester',
  'documenter',
  'maintainer',
]);

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
]);

const artifactKindSchema = z.enum([
  'implementation_summary',
  'review_report',
  'fix_summary',
  'test_result',
  'git_diff',
  'patch',
  'decision_record',
  'pr_summary',
  'agent_run_log',
]);

const meetingStatusSchema = z.enum(['open', 'closed', 'archived']);

const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'ready_for_review',
  'reviewing',
  'changes_requested',
  'approved',
  'done',
  'blocked',
  'failed',
  'cancelled',
  'conflict',
  'needs_user_decision',
]);

// --- Entities ---

export const MesaAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  client: z.string().min(1),
  roles: z.array(agentRoleSchema).min(1),
});

export const MesaAgentCapabilitySchema = z.object({
  agentId: z.string().min(1),
  permissions: z.array(permissionLevelSchema).min(1),
});

export const TaskContextSchema = z.object({
  goal: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
});

export const MesaTaskSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  status: taskStatusSchema,
  createdBy: z.string().min(1),
  assignedTo: z.string().optional(),
  reviewer: z.string().optional(),
  meetingId: z.string().optional(),
  branch: z.string().optional(),
  context: TaskContextSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const MesaMessageSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  taskId: z.string().optional(),
  from: z.string().min(1),
  to: z.string().optional(),
  type: messageTypeSchema,
  summary: z.string().min(1),
  artifactIds: z.array(z.string()).optional(),
  createdAt: z.string().min(1),
});

export const MesaArtifactSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  kind: artifactKindSchema,
  taskId: z.string().optional(),
  createdBy: z.string().min(1),
  content: z.string(),
  format: z.enum(['markdown', 'json', 'diff', 'text']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().min(1),
});

export const MesaMeetingSchema = z.object({
  protocolVersion: protocolVersionSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  status: meetingStatusSchema,
  tasks: z.array(z.string()),
  agents: z.array(z.string()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

// --- Input schemas (for create operations, without generated fields) ---

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  createdBy: z.string().min(1),
  assignedTo: z.string().optional(),
  reviewer: z.string().optional(),
  meetingId: z.string().optional(),
  branch: z.string().optional(),
  context: TaskContextSchema.optional(),
});

export const CreateMessageInputSchema = z.object({
  taskId: z.string().optional(),
  from: z.string().min(1),
  to: z.string().optional(),
  type: messageTypeSchema,
  summary: z.string().min(1),
  artifactIds: z.array(z.string()).optional(),
});

export const CreateArtifactInputSchema = z.object({
  kind: artifactKindSchema,
  taskId: z.string().optional(),
  createdBy: z.string().min(1),
  content: z.string(),
  format: z.enum(['markdown', 'json', 'diff', 'text']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateMeetingInputSchema = z.object({
  title: z.string().min(1),
  tasks: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
});

// --- Type inference ---

export type MesaAgentInput = z.input<typeof MesaAgentSchema>;
export type MesaTaskInput = z.input<typeof MesaTaskSchema>;
export type MesaMessageInput = z.input<typeof MesaMessageSchema>;
export type MesaArtifactInput = z.input<typeof MesaArtifactSchema>;
export type MesaMeetingInput = z.input<typeof MesaMeetingSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type CreateMessageInput = z.input<typeof CreateMessageInputSchema>;
export type CreateArtifactInput = z.input<typeof CreateArtifactInputSchema>;
export type CreateMeetingInput = z.input<typeof CreateMeetingInputSchema>;
