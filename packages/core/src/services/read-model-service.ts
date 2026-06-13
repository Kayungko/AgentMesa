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
  isTaskProjectionFresh,
  isMeetingProjectionFresh,
  isAgentProjectionFresh,
} from './projection-read-service.js';

function readMode(ctx: MesaRuntimeContext): ReadModelMode {
  return ctx.config.readModel!.mode!;
}

function getReadModelViaProjection<T extends Record<string, unknown>>(
  ctx: MesaRuntimeContext,
  id: string,
  label: string,
  getProjFn: () => T | null,
  isFreshFn: () => boolean,
  legacyGetFn: () => T | null,
): T | null {
  const mode = readMode(ctx);

  // projection mode: strict — missing/stale/corrupt all throw
  if (mode === 'projection') {
    const proj = getProjFn();
    if (!proj) {
      throw new MesaError('PROJECTION_MISSING', `No projection found for ${label} "${id}". Run "mesa rebuild".`);
    }
    if (!isFreshFn()) {
      throw new MesaError('PROJECTION_STALE', `Stale projection for ${label} "${id}". Run "mesa rebuild".`);
    }
    return proj;
  }

  // hybrid mode: fallback to legacy with warn on any projection issue
  if (mode === 'hybrid') {
    let proj: T | null;
    try {
      proj = getProjFn();
    } catch (err) {
      if (err instanceof MesaError) {
        ctx.logger.warn(`${label} projection corrupted, falling back to legacy: ${err.message}`);
        return legacyGetFn();
      }
      throw err;
    }
    if (!proj) {
      ctx.logger.warn(`${label} projection missing, falling back to legacy. Run "mesa rebuild".`);
      return legacyGetFn();
    }
    if (!isFreshFn()) {
      ctx.logger.warn(`${label} projection stale, falling back to legacy. Run "mesa rebuild".`);
      return legacyGetFn();
    }
    return proj;
  }

  // legacy mode
  return legacyGetFn();
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
  return getReadModelViaProjection(
    ctx, taskId, 'task',
    () => getTaskProjection(ctx, taskId),
    () => isTaskProjectionFresh(ctx, taskId),
    () => {
      try {
        return getTask(ctx, taskId) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  );
}

export function listTaskReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    const projs = listTaskProjections(ctx);
    for (const p of projs) {
      const id = p.id as string;
      if (!isTaskProjectionFresh(ctx, id)) {
        throw new MesaError('PROJECTION_STALE', `Stale projection for task "${id}". Run "mesa rebuild".`);
      }
    }
    return projs;
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listTaskProjections(ctx), 'task');
    if (projs !== null && projs.length > 0) {
      let anyStale = false;
      for (const p of projs) {
        const id = p.id as string;
        if (!isTaskProjectionFresh(ctx, id)) {
          anyStale = true;
          break;
        }
      }
      if (!anyStale) return projs;
      ctx.logger.warn('task projections contain stale entries, falling back to legacy. Run "mesa rebuild".');
    }
  }

  return listTasks(ctx) as unknown as Record<string, unknown>[];
}

export function getMeetingReadModel(ctx: MesaRuntimeContext, meetingId: string): Record<string, unknown> | null {
  return getReadModelViaProjection(
    ctx, meetingId, 'meeting',
    () => getMeetingProjection(ctx, meetingId),
    () => isMeetingProjectionFresh(ctx, meetingId),
    () => {
      try {
        return getMeeting(ctx, meetingId) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  );
}

export function listMeetingReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    const projs = listMeetingProjections(ctx);
    for (const p of projs) {
      const id = p.id as string;
      if (!isMeetingProjectionFresh(ctx, id)) {
        throw new MesaError('PROJECTION_STALE', `Stale projection for meeting "${id}". Run "mesa rebuild".`);
      }
    }
    return projs;
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listMeetingProjections(ctx), 'meeting');
    if (projs !== null && projs.length > 0) {
      let anyStale = false;
      for (const p of projs) {
        const id = p.id as string;
        if (!isMeetingProjectionFresh(ctx, id)) {
          anyStale = true;
          break;
        }
      }
      if (!anyStale) return projs;
      ctx.logger.warn('meeting projections contain stale entries, falling back to legacy. Run "mesa rebuild".');
    }
  }

  return listMeetings(ctx) as unknown as Record<string, unknown>[];
}

export function getAgentReadModel(ctx: MesaRuntimeContext, agentId: string): Record<string, unknown> | null {
  return getReadModelViaProjection(
    ctx, agentId, 'agent',
    () => getAgentProjection(ctx, agentId),
    () => isAgentProjectionFresh(ctx, agentId),
    () => {
      try {
        return getAgent(ctx, agentId) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  );
}

export function listAgentReadModels(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  const mode = readMode(ctx);

  if (mode === 'projection') {
    const projs = listAgentProjections(ctx);
    for (const p of projs) {
      const id = p.id as string;
      if (!isAgentProjectionFresh(ctx, id)) {
        throw new MesaError('PROJECTION_STALE', `Stale projection for agent "${id}". Run "mesa rebuild".`);
      }
    }
    return projs;
  }

  if (mode === 'hybrid') {
    const projs = tryListProjections(ctx, () => listAgentProjections(ctx), 'agent');
    if (projs !== null && projs.length > 0) {
      let anyStale = false;
      for (const p of projs) {
        const id = p.id as string;
        if (!isAgentProjectionFresh(ctx, id)) {
          anyStale = true;
          break;
        }
      }
      if (!anyStale) return projs;
      ctx.logger.warn('agent projections contain stale entries, falling back to legacy. Run "mesa rebuild".');
    }
  }

  return listAgents(ctx) as unknown as Record<string, unknown>[];
}
