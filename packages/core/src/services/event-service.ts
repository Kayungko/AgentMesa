import type { MesaEvent } from '@agentmesa/protocol';
import type { MesaEventFilter, MesaRuntimeContext } from '../runtime/types.js';
import { assertPolicy } from './runtime-service-utils.js';

export function listEvents(
  ctx: MesaRuntimeContext,
  filter?: MesaEventFilter,
): MesaEvent[] {
  assertPolicy(ctx, 'event.read', 'events:*');
  return ctx.eventStore.list(filter);
}

export function getTaskEvents(
  ctx: MesaRuntimeContext,
  taskId: string,
): MesaEvent[] {
  assertPolicy(ctx, 'event.read', `events:task:${taskId}`);
  return ctx.eventStore.list({ streamId: taskId });
}

/** Events belonging to the meeting's own stream (streamId === meetingId). */
export function getMeetingStreamEvents(
  ctx: MesaRuntimeContext,
  meetingId: string,
): MesaEvent[] {
  assertPolicy(ctx, 'event.read', `events:meeting:${meetingId}`);
  return ctx.eventStore.list({ streamId: meetingId });
}

/** All events for a meeting across every stream (meetingId === meetingId). */
export function getMeetingEvents(
  ctx: MesaRuntimeContext,
  meetingId: string,
): MesaEvent[] {
  assertPolicy(ctx, 'event.read', `events:meeting:${meetingId}`);
  return ctx.eventStore.list({ meetingId });
}
