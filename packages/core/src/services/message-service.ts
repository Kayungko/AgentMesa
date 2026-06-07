import { join } from 'node:path';
import {
  MesaMessageSchema,
  CreateMessageInputSchema,
  mesaProtocolVersion,
} from '@agentmesa/protocol';
import type { MesaMessage, CreateMessageInput } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import { readJson, writeJson, listJson } from '../storage.js';

let messageCounter = 0;

function generateMessageId(): string {
  messageCounter++;
  return `M-${String(messageCounter).padStart(4, '0')}`;
}

export function resetMessageCounter(): void {
  messageCounter = 0;
}

export function appendMessage(paths: MesaWorkspacePaths, input: CreateMessageInput): MesaMessage {
  const validated = CreateMessageInputSchema.parse(input);

  const message: MesaMessage = {
    protocolVersion: mesaProtocolVersion,
    id: generateMessageId(),
    taskId: validated.taskId,
    from: validated.from,
    to: validated.to,
    type: validated.type,
    summary: validated.summary,
    artifactIds: validated.artifactIds,
    createdAt: new Date().toISOString(),
  };

  const result = MesaMessageSchema.parse(message);
  writeJson(join(paths.messagesDir, `${message.id}.json`), result);

  return result;
}

export function getMessage(paths: MesaWorkspacePaths, messageId: string): MesaMessage {
  const message = readJson<MesaMessage>(join(paths.messagesDir, `${messageId}.json`));
  if (!message) {
    return null as never;
  }
  return MesaMessageSchema.parse(message);
}

export function listMessages(paths: MesaWorkspacePaths): MesaMessage[] {
  return listJson<MesaMessage>(paths.messagesDir)
    .map((m) => MesaMessageSchema.safeParse(m))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaMessage }).data);
}

export function getMessagesByTask(paths: MesaWorkspacePaths, taskId: string): MesaMessage[] {
  return listMessages(paths).filter((m) => m.taskId === taskId);
}
