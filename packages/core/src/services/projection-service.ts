import type { MesaEvent } from '@agentmesa/protocol';
import { join } from 'node:path';
import { MesaError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';

// --- Lightweight projection validation ---

interface ProjectionMeta {
  source: 'event_rebuild';
  rebuiltAt: string;
  lastEventId: string;
  lastSequence: number;
  projectionVersion: 1;
}

function validateMeta(raw: unknown): ProjectionMeta {
  const m = raw as Record<string, unknown>;
  if (
    typeof m !== 'object' || m === null ||
    m.source !== 'event_rebuild' ||
    typeof m.rebuiltAt !== 'string' ||
    typeof m.lastEventId !== 'string' ||
    typeof m.lastSequence !== 'number' ||
    m.projectionVersion !== 1
  ) {
    throw new MesaError('STORAGE_ERROR', 'Invalid projection metadata');
  }
  return m as unknown as ProjectionMeta;
}

function assertStringOrUndefined(val: unknown): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val !== 'string') throw new MesaError('STORAGE_ERROR', `Expected string, got ${typeof val}`);
  return val;
}

function validateProjection(raw: Record<string, unknown>, type: string): void {
  if (typeof raw.id !== 'string' || raw.type !== type) {
    throw new MesaError('STORAGE_ERROR', `Invalid ${type} projection: missing id or wrong type`);
  }
  validateMeta(raw._meta);
  if (type === 'meeting') {
    if (!Array.isArray(raw.taskIds)) throw new MesaError('STORAGE_ERROR', 'Meeting projection missing taskIds');
    if (!Array.isArray(raw.agentIds)) throw new MesaError('STORAGE_ERROR', 'Meeting projection missing agentIds');
  }
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
    list.sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp));
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

    if (event.type === 'task_deleted') {
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

export function rebuildTaskProjections(ctx: MesaRuntimeContext): number {
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

export function rebuildMeetingProjections(ctx: MesaRuntimeContext): number {
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

export function rebuildAgentProjections(ctx: MesaRuntimeContext): number {
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

export function rebuildAllProjections(ctx: MesaRuntimeContext): { tasks: number; meetings: number; agents: number } {
  return {
    tasks: rebuildTaskProjections(ctx),
    meetings: rebuildMeetingProjections(ctx),
    agents: rebuildAgentProjections(ctx),
  };
}
