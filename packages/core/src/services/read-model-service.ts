import type { ReadModelMode, MesaRuntimeContext } from '../runtime/types.js';
import { getTask, listTasks } from './task-service.js';
import { getMeeting, listMeetings } from './meeting-service.js';
import { getAgent, listAgents } from './agent-registry.js';
import {
  getTaskProjection,
  getMeetingProjection,
  getAgentProjection,
  listTaskProjections,
  listMeetingProjections,
  listAgentProjections,
} from './projection-read-service.js';

function readMode(ctx: MesaRuntimeContext): ReadModelMode {
  return ctx.config.readModel!.mode!;
}

export function getTaskReadModel(ctx: MesaRuntimeContext, taskId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getTaskProjection(ctx, taskId, { strict: false });
  }

  if (mode === 'hybrid') {
    const proj = getTaskProjection(ctx, taskId, { strict: false });
    if (proj !== null) return proj;
  }

  // legacy (or hybrid fallback)
  try {
    return getTask(ctx, taskId) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listTaskReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return listTaskProjections(ctx, { strict: false });
  }

  if (mode === 'hybrid') {
    const projs = listTaskProjections(ctx, { strict: false });
    if (projs.length > 0) return projs;
  }

  // legacy (or hybrid fallback when no projections exist)
  return listTasks(ctx) as unknown as Record<string, unknown>[];
}

export function getMeetingReadModel(ctx: MesaRuntimeContext, meetingId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getMeetingProjection(ctx, meetingId, { strict: false });
  }

  if (mode === 'hybrid') {
    const proj = getMeetingProjection(ctx, meetingId, { strict: false });
    if (proj !== null) return proj;
  }

  try {
    return getMeeting(ctx, meetingId) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listMeetingReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return listMeetingProjections(ctx, { strict: false });
  }

  if (mode === 'hybrid') {
    const projs = listMeetingProjections(ctx, { strict: false });
    if (projs.length > 0) return projs;
  }

  return listMeetings(ctx) as unknown as Record<string, unknown>[];
}

export function getAgentReadModel(ctx: MesaRuntimeContext, agentId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getAgentProjection(ctx, agentId, { strict: false });
  }

  if (mode === 'hybrid') {
    const proj = getAgentProjection(ctx, agentId, { strict: false });
    if (proj !== null) return proj;
  }

  try {
    return getAgent(ctx, agentId) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listAgentReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return listAgentProjections(ctx, { strict: false });
  }

  if (mode === 'hybrid') {
    const projs = listAgentProjections(ctx, { strict: false });
    if (projs.length > 0) return projs;
  }

  return listAgents(ctx) as unknown as Record<string, unknown>[];
}
