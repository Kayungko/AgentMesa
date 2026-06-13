import { MesaError } from '../errors.js';
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

function tryGetProjection<T>(
  ctx: MesaRuntimeContext,
  getFn: () => T,
  fallbackLabel: string,
): T | null {
  try {
    return getFn();
  } catch (err) {
    if (err instanceof MesaError) {
      ctx.logger.warn(`${fallbackLabel} projection corrupted, falling back to legacy: ${err.message}`);
      return null;
    }
    throw err;
  }
}

function tryListProjections<T>(
  ctx: MesaRuntimeContext,
  listFn: () => T[],
  fallbackLabel: string,
): T[] | null {
  try {
    return listFn();
  } catch (err) {
    if (err instanceof MesaError) {
      ctx.logger.warn(`${fallbackLabel} projections corrupted, falling back to legacy: ${err.message}`);
      return null;
    }
    throw err;
  }
}

export function getTaskReadModel(ctx: MesaRuntimeContext, taskId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getTaskProjection(ctx, taskId); // strict:true by default
  }

  if (mode === 'hybrid') {
    const proj = tryGetProjection(ctx, () => getTaskProjection(ctx, taskId), 'task');
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
    return listTaskProjections(ctx); // strict:true by default
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listTaskProjections(ctx), 'task');
    if (projs !== null && projs.length > 0) return projs;
  }

  // legacy (or hybrid fallback when no projections exist)
  return listTasks(ctx) as unknown as Record<string, unknown>[];
}

export function getMeetingReadModel(ctx: MesaRuntimeContext, meetingId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getMeetingProjection(ctx, meetingId); // strict:true by default
  }

  if (mode === 'hybrid') {
    const proj = tryGetProjection(ctx, () => getMeetingProjection(ctx, meetingId), 'meeting');
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
    return listMeetingProjections(ctx); // strict:true by default
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listMeetingProjections(ctx), 'meeting');
    if (projs !== null && projs.length > 0) return projs;
  }

  return listMeetings(ctx) as unknown as Record<string, unknown>[];
}

export function getAgentReadModel(ctx: MesaRuntimeContext, agentId: string): Record<string, unknown> | null {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    return getAgentProjection(ctx, agentId); // strict:true by default
  }

  if (mode === 'hybrid') {
    const proj = tryGetProjection(ctx, () => getAgentProjection(ctx, agentId), 'agent');
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
    return listAgentProjections(ctx); // strict:true by default
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listAgentProjections(ctx), 'agent');
    if (projs !== null && projs.length > 0) return projs;
  }

  return listAgents(ctx) as unknown as Record<string, unknown>[];
}
