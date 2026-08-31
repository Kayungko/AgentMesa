import { join } from 'node:path';
import {
  MesaMessageSchema,
  CreateMessageInputSchema,
  currentProtocolVersion,
  generateMessageId,
} from '@agentmesa/protocol';
import type { MesaMessage, CreateMessageInput } from '@agentmesa/protocol';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export type CreateMessageRuntimeInput = Omit<CreateMessageInput, 'from'> & {
  from?: string;
};

export function appendMessage(
  ctx: MesaRuntimeContext,
  input: CreateMessageRuntimeInput
): MesaMessage {
  assertPolicy(ctx, 'message.append', input.taskId ? `task:${input.taskId}` : 'message');
  const validated = CreateMessageInputSchema.parse({
    ...input,
    from: ctx.actor.id,
  });

  const message: MesaMessage = {
    protocolVersion: currentProtocolVersion,
    id: generateMessageId(),
    meetingId: validated.meetingId,
    taskId: validated.taskId,
    threadId: validated.threadId,
    replyToMessageId: validated.replyToMessageId,
    correlationId: validated.correlationId,
    replyTo: validated.replyTo,
    causationId: validated.causationId,
    from: validated.from,
    senderAgentId: validated.senderAgentId,
    to: validated.to,
    type: validated.type,
    summary: validated.summary,
    body: validated.body,
    artifactIds: validated.artifactIds,
    // Imported sessions pass a historical createdAt so the timeline keeps the
    // source transcript's order; live messages fall back to "now".
    createdAt: validated.createdAt ?? new Date().toISOString(),
  };

  const result = MesaMessageSchema.parse(message);
  writeMessage(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: result.meetingId ?? result.taskId ?? 'workspace',
    type: 'message_sent',
    streamId: result.id,
    streamType: 'message',
    data: { message: result },
  });

  return result;
}

export function getMessage(ctx: MesaRuntimeContext, messageId: string): MesaMessage {
  const message = readJsonFromStorage<MesaMessage>(
    ctx,
    join(ctx.paths.messagesDir, `${messageId}.json`)
  );
  if (!message) {
    return null as never;
  }
  return MesaMessageSchema.parse(message);
}

export function listMessages(ctx: MesaRuntimeContext): MesaMessage[] {
  return listJsonFromStorage<MesaMessage>(ctx, ctx.paths.messagesDir)
    .map((m) => MesaMessageSchema.safeParse(m))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaMessage }).data);
}

export function getMessagesByTask(ctx: MesaRuntimeContext, taskId: string): MesaMessage[] {
  return listMessages(ctx).filter((m) => m.taskId === taskId);
}

function writeMessage(ctx: MesaRuntimeContext, message: MesaMessage): void {
  writeJsonToStorage(
    ctx,
    join(ctx.paths.messagesDir, `${message.id}.json`),
    message
  );
}
