import { z } from 'zod';
import { currentProtocolVersion } from './version.js';

export const transportDirectionSchema = z.enum(['inbound', 'outbound']);

export const transportEnvelopeStatusSchema = z.enum(['pending', 'processed', 'failed']);

export const TransportEnvelopeSchema = z.object({
  id: z.string().min(1),
  protocolVersion: z.enum(['0.1.0', '0.2.0']).default(currentProtocolVersion),
  transport: z.string().min(1),
  direction: transportDirectionSchema,
  actor: z.string().min(1),
  meetingId: z.string().optional(),
  taskId: z.string().optional(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  correlationId: z.string().optional(),
  replyTo: z.string().optional(),
  status: transportEnvelopeStatusSchema.default('pending'),
  error: z.string().optional(),
});
