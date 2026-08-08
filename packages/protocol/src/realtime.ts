import { z } from 'zod';
import { MesaEventSchema } from './schemas.js';

export const EventCursorSchema = z.string().min(1);

export const EventEnvelopeSchema = z.object({
  cursor: EventCursorSchema,
  event: MesaEventSchema,
});

export const RunProgressSchema = z.object({
  stage: z.string().min(1),
  message: z.string().min(1),
  percent: z.number().min(0).max(100).optional(),
});

export const WorkflowDecisionCommandSchema = z.object({
  commandId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

export const CommandAckSchema = z.object({
  commandId: z.string().min(1),
  accepted: z.boolean(),
  duplicate: z.boolean().default(false),
  result: z.unknown().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type RunProgress = z.infer<typeof RunProgressSchema>;
export type WorkflowDecisionCommand = z.infer<typeof WorkflowDecisionCommandSchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
