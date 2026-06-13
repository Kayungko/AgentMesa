import type { MesaEvent } from '@agentmesa/protocol';
import { join } from 'node:path';
import type { MesaRuntimeContext } from '../runtime/types.js';

interface ProjectionMeta {
  source: 'event_rebuild';
  rebuiltAt: string;
  lastEventId: string;
  lastSequence: number;
  projectionVersion: 1;
}

interface TaskProjection {
  id: string;
  type: 'task';
  deleted?: boolean;
  deletedAt?: string;
  title?: string;
  status?: string;
  assignedTo?: string;
  reviewer?: string;
  meetingId?: string;
  [key: string]: unknown;
  _meta: ProjectionMeta;
}

interface MeetingProjection {
  id: string;
  type: 'meeting';
  title?: string;
  status?: string;
  taskIds: string[];
  agentIds: string[];
  [key: string]: unknown;
  _meta: ProjectionMeta;
}

function buildMeta(lastEvent: MesaEvent): ProjectionMeta {
  return {
    source: 'event_rebuild',
    rebuiltAt: new Date().toISOString(),
    lastEventId: lastEvent.id,
    lastSequence: lastEvent.sequence,
    projectionVersion: 1,
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
  // sort each group by sequence (fallback to timestamp)
  for (const list of map.values()) {
    list.sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp));
  }
  return map;
}

function replayTask(events: MesaEvent[]): TaskProjection | null {
  let projection: TaskProjection | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    if (event.type === 'task_created') {
      const task = data.task as Record<string, unknown> | undefined;
      projection = {
        id: event.streamId,
        type: 'task',
        title: task?.title as string | undefined,
        status: task?.status as string | undefined,
        assignedTo: task?.assignedTo as string | undefined,
        reviewer: task?.reviewer as string | undefined,
        meetingId: task?.meetingId as string | undefined,
        ...task,
        _meta: buildMeta(event),
      };
      continue;
    }

    if (!projection) {
      // orphan event (no task_created seen) — skip
      continue;
    }

    if (event.type === 'task_status_changed') {
      projection.status = data.newStatus as string | undefined;
    }

    if (event.type === 'task_assigned') {
      if (data.assignedTo !== undefined) projection.assignedTo = data.assignedTo as string;
      if (data.reviewer !== undefined) projection.reviewer = data.reviewer as string;
    }

    if (event.type === 'task_deleted') {
      projection.deleted = true;
      projection.deletedAt = event.timestamp;
    }

    projection._meta = buildMeta(event);
  }

  return projection;
}

function replayMeeting(events: MesaEvent[]): MeetingProjection | null {
  let projection: MeetingProjection | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    if (event.type === 'meeting_created') {
      const meeting = data.meeting as Record<string, unknown> | undefined;
      projection = {
        id: event.streamId,
        type: 'meeting',
        title: meeting?.title as string | undefined,
        status: meeting?.status as string | undefined,
        taskIds: Array.isArray(meeting?.taskIds) ? (meeting!.taskIds as string[]) : [],
        agentIds: Array.isArray(meeting?.agentIds) ? (meeting!.agentIds as string[]) : [],
        ...meeting,
        _meta: buildMeta(event),
      };
      continue;
    }

    if (!projection) {
      continue;
    }

    if (event.type === 'meeting_status_changed') {
      projection.status = data.newStatus as string | undefined;
    }

    if (event.type === 'meeting_task_added') {
      const taskId = data.taskId as string;
      if (taskId && !projection.taskIds.includes(taskId)) {
        projection.taskIds = [...projection.taskIds, taskId];
      }
    }

    if (event.type === 'meeting_agent_added') {
      const agentId = data.agentId as string;
      if (agentId && !projection.agentIds.includes(agentId)) {
        projection.agentIds = [...projection.agentIds, agentId];
      }
    }

    projection._meta = buildMeta(event);
  }

  return projection;
}

export function rebuildTaskProjections(ctx: MesaRuntimeContext): number {
  const allEvents = ctx.eventStore.list();
  const streams = eventsByStream(allEvents);
  let count = 0;

  ctx.storage.ensureDirectory(ctx.paths.taskProjectionsDir);

  for (const [streamId, events] of streams) {
    const firstEventType = events[0]?.type;
    if (firstEventType !== 'task_created') continue;

    const projection = replayTask(events);
    if (!projection) continue;

    const filePath = join(ctx.paths.taskProjectionsDir, `${streamId}.json`);
    ctx.storage.writeText(filePath, `${JSON.stringify(projection, null, 2)}\n`);
    count++;
  }

  return count;
}

export function rebuildMeetingProjections(ctx: MesaRuntimeContext): number {
  const allEvents = ctx.eventStore.list();
  const streams = eventsByStream(allEvents);
  let count = 0;

  ctx.storage.ensureDirectory(ctx.paths.meetingProjectionsDir);

  for (const [streamId, events] of streams) {
    const firstEventType = events[0]?.type;
    if (firstEventType !== 'meeting_created') continue;

    const projection = replayMeeting(events);
    if (!projection) continue;

    const filePath = join(ctx.paths.meetingProjectionsDir, `${streamId}.json`);
    ctx.storage.writeText(filePath, `${JSON.stringify(projection, null, 2)}\n`);
    count++;
  }

  return count;
}

export function rebuildAllProjections(ctx: MesaRuntimeContext): { tasks: number; meetings: number } {
  return {
    tasks: rebuildTaskProjections(ctx),
    meetings: rebuildMeetingProjections(ctx),
  };
}
