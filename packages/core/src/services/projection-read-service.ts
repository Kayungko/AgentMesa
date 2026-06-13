import { join } from 'node:path';
import type { MesaRuntimeContext } from '../runtime/types.js';

function readProjectionFile(ctx: MesaRuntimeContext, dir: string, id: string): Record<string, unknown> | null {
  const filePath = join(dir, `${id}.json`);
  const content = ctx.storage.readText(filePath);
  if (content === null) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function listProjectionFiles(ctx: MesaRuntimeContext, dir: string): Record<string, unknown>[] {
  return ctx.storage
    .list(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const content = ctx.storage.readText(join(dir, name));
      if (content === null) return null;
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((p): p is Record<string, unknown> => p !== null);
}

export function getTaskProjection(ctx: MesaRuntimeContext, taskId: string): Record<string, unknown> | null {
  return readProjectionFile(ctx, ctx.paths.taskProjectionsDir, taskId);
}

export function getMeetingProjection(ctx: MesaRuntimeContext, meetingId: string): Record<string, unknown> | null {
  return readProjectionFile(ctx, ctx.paths.meetingProjectionsDir, meetingId);
}

export function getAgentProjection(ctx: MesaRuntimeContext, agentId: string): Record<string, unknown> | null {
  return readProjectionFile(ctx, ctx.paths.agentProjectionsDir, agentId);
}

export function listTaskProjections(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.taskProjectionsDir);
}

export function listMeetingProjections(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.meetingProjectionsDir);
}

export function listAgentProjections(ctx: MesaRuntimeContext): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.agentProjectionsDir);
}
