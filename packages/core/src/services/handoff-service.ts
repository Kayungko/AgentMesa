import {
  generateEnvelopeId,
  currentProtocolVersion,
  ReviewRequestPayloadSchema,
  ReviewResultPayloadSchema,
} from '@agentmesa/protocol';
import type {
  TransportEnvelope,
  ReviewRequestPayload,
  ReviewResultPayload,
} from '@agentmesa/protocol';
import { MesaError } from '../errors.js';
import type { MesaRuntimeContext, MesaTransport } from '../runtime/types.js';
import { assertPolicy } from './runtime-service-utils.js';

function findFileTransport(ctx: MesaRuntimeContext): MesaTransport {
  const transport = ctx.transports.find((t) => t.type === 'file');
  if (!transport) {
    throw new MesaError('TRANSPORT_NOT_FOUND', 'No file transport available for handoff');
  }
  return transport;
}

export type { ReviewRequestPayload, ReviewResultPayload };

export function writeReviewRequest(
  ctx: MesaRuntimeContext,
  payload: ReviewRequestPayload,
): TransportEnvelope {
  assertPolicy(ctx, 'handoff.write', `run:${payload.runId}`);
  const validated = ReviewRequestPayloadSchema.parse(payload);
  const transport = findFileTransport(ctx);
  if (typeof transport.writeOutbound !== 'function') {
    throw new MesaError('TRANSPORT_NOT_FOUND', 'File transport does not support writeOutbound');
  }

  const envelope: TransportEnvelope = {
    id: generateEnvelopeId(),
    protocolVersion: currentProtocolVersion,
    transport: transport.name,
    direction: 'outbound',
    actor: ctx.actor.id,
    taskId: validated.taskId,
    type: 'review_request',
    createdAt: new Date().toISOString(),
    payload: { ...validated },
    status: 'pending',
    correlationId: validated.runId,
  };

  transport.writeOutbound(envelope);
  return envelope;
}

export function writeReviewResult(
  ctx: MesaRuntimeContext,
  payload: ReviewResultPayload,
): TransportEnvelope {
  assertPolicy(ctx, 'handoff.write', `run:${payload.runId}`);
  const validated = ReviewResultPayloadSchema.parse(payload);
  const transport = findFileTransport(ctx);
  if (typeof transport.writeInbound !== 'function') {
    throw new MesaError('TRANSPORT_NOT_FOUND', 'File transport does not support writeInbound');
  }

  const envelope: TransportEnvelope = {
    id: generateEnvelopeId(),
    protocolVersion: currentProtocolVersion,
    transport: transport.name,
    direction: 'inbound',
    actor: ctx.actor.id,
    taskId: validated.taskId,
    type: 'review_result',
    createdAt: new Date().toISOString(),
    payload: { ...validated },
    status: 'pending',
    correlationId: validated.runId,
  };

  transport.writeInbound(envelope);
  return envelope;
}

export function listOutboundHandoffs(
  ctx: MesaRuntimeContext,
): TransportEnvelope[] {
  assertPolicy(ctx, 'handoff.read', 'transport:outbox');
  const transport = findFileTransport(ctx);
  if (typeof transport.listOutbound !== 'function') {
    return [];
  }
  return transport.listOutbound();
}

export function listInboundHandoffs(
  ctx: MesaRuntimeContext,
): TransportEnvelope[] {
  assertPolicy(ctx, 'handoff.read', 'transport:inbox');
  const transport = findFileTransport(ctx);
  if (typeof transport.listInbound !== 'function') {
    return [];
  }
  return transport.listInbound();
}
