import type { MesaEvent } from '@agentmesa/protocol';
import { join } from 'node:path';
import {
  TaskProjectionSchema,
  MeetingProjectionSchema,
  AgentProjectionSchema,
  type ProjectionMeta,
} from './projection-schemas.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { assertPolicy } from './runtime-service-utils.js';

export interface RebuildOptions {
  /** Remove all existing projection files before rebuilding. */
  clean?: boolean;
}

function validateProjection(raw: Record<string, unknown>, type: string): void {
  if (type === 'task') TaskProjectionSchema.parse(raw);
  else if (type === 'meeting') MeetingProjectionSchema.parse(raw);
  else AgentProjectionSchema.parse(raw);
}

// --- Replay helpers ---

function buildMeta(lastEvent: MesaEvent) {
  return {
    source: 'event_rebuild' as const,
    rebuiltAt: new Date().toISOString(),
    lastEventId: lastEvent.id,
    lastSequence: lastEvent.sequence,
    projectionVersion: 1 as const,
  };
}

/**
 * Sort order for deterministic replay:
 *   1. sequence (numeric)
 *   2. timestamp (ISO 8601 lexical)
 *   3. id (lexical, tiebreaker)
 *
 * This guarantees the same projection output for the same set of events,
 * even when multiple events share a sequence number or timestamp.
 */
function eventsByStream(events: MesaEvent[]): Map<string, MesaEvent[]> {
  const map = new Map<string, MesaEvent[]>();
  for (const e of events) {
    const list = map.get(e.streamId);
    if (list) {
      list.push(e);
    } else {
      map.set(e.streamId, [e]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  }
  return map;
}

function replayTask(events: MesaEvent[]) {
  let projection: Record<string, unknown> | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    if (event.type === 'task_created') {
      const task = data.task as Record<string, unknown> | undefined;
      projection = {
        id: event.streamId,
        type: 'task',
        title: task?.title,
        status: task?.status,
        assignedTo: task?.assignedTo,
        reviewer: task?.reviewer,
        meetingId: task?.meetingId,
        ...task,
        _meta: buildMeta(event),
      };
      continue;
    }

    if (!projection) continue;

    if (event.type === 'task_status_changed') {
      projection.status = data.newStatus;
    }

    if (event.type === 'task_assigned') {
      if (data.assignedTo !== undefined) projection.assignedTo = data.assignedTo;
      if (data.reviewer !== undefined) projection.reviewer = data.reviewer;
    }

    if (event.type === 'task_deleted' || event.type === 'task_archived') {
      projection.deleted = true;
      projection.deletedAt = event.timestamp;
    }

    projection._meta = buildMeta(event);
  }

  return projection;
}

function replayMeeting(events: MesaEvent[]) {
  let projection: Record<string, unknown> | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    if (event.type === 'meeting_created') {
      const meeting = data.meeting as Record<string, unknown> | undefined;
      // Current schema: meeting.tasks / meeting.agents
      // Future aliases: meeting.taskIds / meeting.agentIds
      const seedTasks = (meeting?.tasks ?? meeting?.taskIds ?? []) as string[];
      const seedAgents = (meeting?.agents ?? meeting?.agentIds ?? []) as string[];

      projection = {
        id: event.streamId,
        type: 'meeting',
        title: meeting?.title,
        status: meeting?.status,
        taskIds: Array.isArray(seedTasks) ? [...seedTasks] : [],
        agentIds: Array.isArray(seedAgents) ? [...seedAgents] : [],
        ...meeting,
        _meta: buildMeta(event),
      };
      continue;
    }

    if (!projection) continue;

    if (event.type === 'meeting_status_changed') {
      projection.status = data.newStatus;
    }

    if (event.type === 'meeting_trust_level_changed') {
      projection.trustLevel = data.newTrustLevel;
    }

    if (event.type === 'meeting_task_added') {
      const taskId = data.taskId as string;
      const taskIds = projection.taskIds as string[];
      if (taskId && !taskIds.includes(taskId)) {
        projection.taskIds = [...taskIds, taskId];
      }
    }

    if (event.type === 'meeting_agent_added') {
      const agentId = data.agentId as string;
      const agentIds = projection.agentIds as string[];
      if (agentId && !agentIds.includes(agentId)) {
        projection.agentIds = [...agentIds, agentId];
      }
    }

    projection._meta = buildMeta(event);
  }

  return projection;
}

function replayAgent(events: MesaEvent[]) {
  let projection: Record<string, unknown> | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    if (event.type === 'agent_registered') {
      const agent = data.agent as Record<string, unknown> | undefined;
      projection = {
        id: event.streamId,
        type: 'agent',
        name: agent?.name,
        client: agent?.client,
        roles: agent?.roles,
        status: agent?.status,
        ...agent,
        _meta: buildMeta(event),
      };
      continue;
    }

    if (!projection) continue;

    projection._meta = buildMeta(event);
  }

  return projection;
}

// --- Rebuild exports ---

function writeProjection(
  ctx: MesaRuntimeContext,
  dir: string,
  streamId: string,
  projection: Record<string, unknown>,
): void {
  ctx.storage.ensureDirectory(dir);
  const filePath = join(dir, `${streamId}.json`);
  ctx.storage.writeText(filePath, `${JSON.stringify(projection, null, 2)}\n`);
}

function cleanProjectionDir(ctx: MesaRuntimeContext, dir: string): number {
  const files = ctx.storage.list(dir);
  let removed = 0;
  for (const file of files) {
    ctx.storage.delete(join(dir, file));
    removed++;
  }
  return removed;
}

export function rebuildTaskProjections(ctx: MesaRuntimeContext, options?: RebuildOptions): number {
  assertPolicy(ctx, 'projection.rebuild', 'task:*');
  if (options?.clean) {
    cleanProjectionDir(ctx, ctx.paths.taskProjectionsDir);
  }

  const allEvents = ctx.eventStore.list();
  const streams = eventsByStream(allEvents);
  let count = 0;

  for (const [, events] of streams) {
    if (events[0]?.type !== 'task_created') continue;

    const projection = replayTask(events);
    if (!projection) continue;

    validateProjection(projection, 'task');
    writeProjection(ctx, ctx.paths.taskProjectionsDir, events[0].streamId, projection);
    count++;
  }

  return count;
}

export function rebuildMeetingProjections(ctx: MesaRuntimeContext, options?: RebuildOptions): number {
  assertPolicy(ctx, 'projection.rebuild', 'meeting:*');
  if (options?.clean) {
    cleanProjectionDir(ctx, ctx.paths.meetingProjectionsDir);
  }

  const allEvents = ctx.eventStore.list();
  const streams = eventsByStream(allEvents);
  let count = 0;

  for (const [, events] of streams) {
    if (events[0]?.type !== 'meeting_created') continue;

    const projection = replayMeeting(events);
    if (!projection) continue;

    validateProjection(projection, 'meeting');
    writeProjection(ctx, ctx.paths.meetingProjectionsDir, events[0].streamId, projection);
    count++;
  }

  return count;
}

export function rebuildAgentProjections(ctx: MesaRuntimeContext, options?: RebuildOptions): number {
  assertPolicy(ctx, 'projection.rebuild', 'agent:*');
  if (options?.clean) {
    cleanProjectionDir(ctx, ctx.paths.agentProjectionsDir);
  }

  const allEvents = ctx.eventStore.list();
  const streams = eventsByStream(allEvents);
  let count = 0;

  for (const [, events] of streams) {
    if (events[0]?.type !== 'agent_registered') continue;

    const projection = replayAgent(events);
    if (!projection) continue;

    validateProjection(projection, 'agent');
    writeProjection(ctx, ctx.paths.agentProjectionsDir, events[0].streamId, projection);
    count++;
  }

  return count;
}

export function rebuildAllProjections(ctx: MesaRuntimeContext, options?: RebuildOptions): { tasks: number; meetings: number; agents: number } {
  return {
    tasks: rebuildTaskProjections(ctx, options),
    meetings: rebuildMeetingProjections(ctx, options),
    agents: rebuildAgentProjections(ctx, options),
  };
}
