import { join } from 'node:path';
import {
  MesaEventSchema,
  currentProtocolVersion,
  generateEventId,
} from '@agentmesa/protocol';
import type { MesaEvent, EventType } from '@agentmesa/protocol';
import { PolicyDeniedError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { withLock } from './lock-manager.js';

export function assertPolicy(
  ctx: MesaRuntimeContext,
  action: string,
  resource: string
): void {
  const decision = ctx.policy.can(ctx.actor, action, resource);
  if (!decision.allowed) {
    throw new PolicyDeniedError(action, resource, decision.reason);
  }
}

export function readJsonFromStorage<T>(
  ctx: MesaRuntimeContext,
  filePath: string
): T | null {
  const content = ctx.storage.readText(filePath);
  if (content === null) {
    return null;
  }
  return JSON.parse(content) as T;
}

export function writeJsonToStorage<T>(
  ctx: MesaRuntimeContext,
  filePath: string,
  value: T
): void {
  ctx.storage.writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function listJsonFromStorage<T>(
  ctx: MesaRuntimeContext,
  dirPath: string
): T[] {
  return ctx.storage
    .list(dirPath)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => ctx.storage.readText(join(dirPath, fileName)))
    .filter((content): content is string => content !== null)
    .map((content) => JSON.parse(content) as T);
}

export function appendRuntimeEvent(
  ctx: MesaRuntimeContext,
  input: {
    meetingId: string;
    type: EventType;
    streamId: string;
    streamType: string;
    data?: Record<string, unknown>;
  }
): void {
  // Lock the entire event log so sequence is derived and appended atomically.
  // Without this lock, two concurrent clients could both read list().length === N,
  // both assign sequence N, and produce a duplicate-sequence event.
  withLock(ctx, 'event_log', () => {
    const sequence = ctx.eventStore.list({ streamId: input.streamId }).length;
    const event: MesaEvent = MesaEventSchema.parse({
      protocolVersion: currentProtocolVersion,
      id: generateEventId(),
      meetingId: input.meetingId,
      type: input.type,
      streamId: input.streamId,
      streamType: input.streamType,
      data: input.data ?? {},
      actor: ctx.actor.id,
      sequence,
      timestamp: new Date().toISOString(),
    });
    ctx.eventStore.append(event);
  });
}
