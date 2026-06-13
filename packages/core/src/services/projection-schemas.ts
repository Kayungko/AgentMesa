import { z } from 'zod';
import type { ZodIssue } from 'zod';
import { MesaError } from '../errors.js';

// --- Meta ---

export const ProjectionMetaSchema = z.object({
  source: z.literal('event_rebuild'),
  rebuiltAt: z.string(),
  lastEventId: z.string(),
  lastSequence: z.number(),
  projectionVersion: z.literal(1),
});

export type ProjectionMeta = z.infer<typeof ProjectionMetaSchema>;

// --- Task ---

export const TaskProjectionSchema = z.object({
  id: z.string().min(1),
  type: z.literal('task'),
  title: z.string().optional(),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  reviewer: z.string().optional(),
  meetingId: z.string().optional(),
  deleted: z.boolean().optional(),
  deletedAt: z.string().optional(),
  _meta: ProjectionMetaSchema,
}).passthrough();

export type TaskProjection = z.infer<typeof TaskProjectionSchema>;

// --- Meeting ---

export const MeetingProjectionSchema = z.object({
  id: z.string().min(1),
  type: z.literal('meeting'),
  title: z.string().optional(),
  status: z.string().optional(),
  taskIds: z.array(z.string()),
  agentIds: z.array(z.string()),
  _meta: ProjectionMetaSchema,
}).passthrough();

export type MeetingProjection = z.infer<typeof MeetingProjectionSchema>;

// --- Agent ---

export const AgentProjectionSchema = z.object({
  id: z.string().min(1),
  type: z.literal('agent'),
  name: z.string().optional(),
  client: z.string().optional(),
  roles: z.array(z.string()).optional(),
  status: z.string().optional(),
  _meta: ProjectionMetaSchema,
}).passthrough();

export type AgentProjection = z.infer<typeof AgentProjectionSchema>;

// --- Parse helpers ---

function formatZodIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

export function parseTaskProjection(raw: unknown): TaskProjection {
  const result = TaskProjectionSchema.safeParse(raw);
  if (!result.success) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Invalid task projection: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

export function parseMeetingProjection(raw: unknown): MeetingProjection {
  const result = MeetingProjectionSchema.safeParse(raw);
  if (!result.success) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Invalid meeting projection: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

export function parseAgentProjection(raw: unknown): AgentProjection {
  const result = AgentProjectionSchema.safeParse(raw);
  if (!result.success) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Invalid agent projection: ${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data;
}
