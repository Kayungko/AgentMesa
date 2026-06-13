import type { MesaEvent } from '@agentmesa/protocol';
import type { MesaEventFilter, MesaRuntimeContext } from '../runtime/types.js';

export function listEvents(
  ctx: MesaRuntimeContext,
  filter?: MesaEventFilter,
): MesaEvent[] {
  return ctx.eventStore.list(filter);
}

export function getTaskEvents(
  ctx: MesaRuntimeContext,
  taskId: string,
): MesaEvent[] {
  return ctx.eventStore.list({ streamId: taskId });
}

/** Events belonging to the meeting's own stream (streamId === meetingId). */
export function getMeetingStreamEvents(
  ctx: MesaRuntimeContext,
  meetingId: string,
): MesaEvent[] {
  return ctx.eventStore.list({ streamId: meetingId });
}

/** All events for a meeting across every stream (meetingId === meetingId). */
export function getMeetingEvents(
  ctx: MesaRuntimeContext,
  meetingId: string,
): MesaEvent[] {
  return ctx.eventStore.list({ meetingId });
}
