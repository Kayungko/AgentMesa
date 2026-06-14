import { join } from 'node:path';
import { MesaError } from '../errors.js';
import {
  parseTaskProjection,
  parseMeetingProjection,
  parseAgentProjection,
  type TaskProjection,
  type MeetingProjection,
  type AgentProjection,
} from './projection-schemas.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { assertPolicy } from './runtime-service-utils.js';

export interface ReadProjectionOptions {
  /** When false, skip invalid projections instead of throwing. Default true. */
  strict?: boolean;
}

function readProjectionFile(
  ctx: MesaRuntimeContext,
  dir: string,
  id: string,
  strict: boolean,
): Record<string, unknown> | null {
  const filePath = join(dir, `${id}.json`);
  const content = ctx.storage.readText(filePath);
  if (content === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    if (strict) throw new MesaError('VALIDATION_ERROR', `Corrupted projection file "${filePath}": invalid JSON`);
    return null;
  }

  return raw as Record<string, unknown>;
}

function validateProjection(raw: Record<string, unknown>, type: string, filePath: string, strict: boolean): Record<string, unknown> | null {
  try {
    if (type === 'task') return parseTaskProjection(raw) as unknown as Record<string, unknown>;
    if (type === 'meeting') return parseMeetingProjection(raw) as unknown as Record<string, unknown>;
    return parseAgentProjection(raw) as unknown as Record<string, unknown>;
  } catch (err) {
    if (strict) throw new MesaError('VALIDATION_ERROR', `Invalid projection "${filePath}": ${String(err)}`);
    return null;
  }
}

function listProjectionFiles(
  ctx: MesaRuntimeContext,
  dir: string,
  type: string,
  strict: boolean,
): Record<string, unknown>[] {
  return ctx.storage
    .list(dir)
    .filter((name) => name.endsWith('.json'))
    .reduce<Record<string, unknown>[]>((acc, name) => {
      const filePath = join(dir, name);
      const raw = readProjectionFile(ctx, dir, name.replace(/\.json$/, ''), strict);
      if (raw === null) return acc; // file gone or corrupted (lenient)
      const validated = validateProjection(raw, type, filePath, strict);
      if (validated !== null) acc.push(validated);
      return acc;
    }, []);
}

export function _getTaskProjection(ctx: MesaRuntimeContext, taskId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  const strict = options?.strict ?? true;
  const raw = readProjectionFile(ctx, ctx.paths.taskProjectionsDir, taskId, strict);
  if (raw === null) return null;
  return validateProjection(raw, 'task', join(ctx.paths.taskProjectionsDir, `${taskId}.json`), strict);
}

export function getTaskProjection(ctx: MesaRuntimeContext, taskId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  assertPolicy(ctx, 'projection.read', `task:${taskId}`);
  return _getTaskProjection(ctx, taskId, options);
}

export function _getMeetingProjection(ctx: MesaRuntimeContext, meetingId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  const strict = options?.strict ?? true;
  const raw = readProjectionFile(ctx, ctx.paths.meetingProjectionsDir, meetingId, strict);
  if (raw === null) return null;
  return validateProjection(raw, 'meeting', join(ctx.paths.meetingProjectionsDir, `${meetingId}.json`), strict);
}

export function getMeetingProjection(ctx: MesaRuntimeContext, meetingId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  assertPolicy(ctx, 'projection.read', `meeting:${meetingId}`);
  return _getMeetingProjection(ctx, meetingId, options);
}

export function _getAgentProjection(ctx: MesaRuntimeContext, agentId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  const strict = options?.strict ?? true;
  const raw = readProjectionFile(ctx, ctx.paths.agentProjectionsDir, agentId, strict);
  if (raw === null) return null;
  return validateProjection(raw, 'agent', join(ctx.paths.agentProjectionsDir, `${agentId}.json`), strict);
}

export function getAgentProjection(ctx: MesaRuntimeContext, agentId: string, options?: ReadProjectionOptions): Record<string, unknown> | null {
  assertPolicy(ctx, 'projection.read', `agent:${agentId}`);
  return _getAgentProjection(ctx, agentId, options);
}

export function _listTaskProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.taskProjectionsDir, 'task', options?.strict ?? true);
}

export function listTaskProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  assertPolicy(ctx, 'projection.read', 'task:*');
  return _listTaskProjections(ctx, options);
}

export function _listMeetingProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.meetingProjectionsDir, 'meeting', options?.strict ?? true);
}

export function listMeetingProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  assertPolicy(ctx, 'projection.read', 'meeting:*');
  return _listMeetingProjections(ctx, options);
}

export function _listAgentProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  return listProjectionFiles(ctx, ctx.paths.agentProjectionsDir, 'agent', options?.strict ?? true);
}

export function listAgentProjections(ctx: MesaRuntimeContext, options?: ReadProjectionOptions): Record<string, unknown>[] {
  assertPolicy(ctx, 'projection.read', 'agent:*');
  return _listAgentProjections(ctx, options);
}

// Re-export types
export type { TaskProjection, MeetingProjection, AgentProjection };

// --- Freshness ---

function maxEventSequence(ctx: MesaRuntimeContext, streamId: string): number {
  const events = ctx.eventStore.list({ streamId });
  if (events.length === 0) return -1;
  return events.reduce((max, e) => Math.max(max, e.sequence), -1);
}

export function isTaskProjectionFresh(ctx: MesaRuntimeContext, taskId: string): boolean {
  const proj = _getTaskProjection(ctx, taskId, { strict: false });
  if (!proj) return false;
  const lastSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
  if (lastSeq === undefined) return false;
  return lastSeq >= maxEventSequence(ctx, taskId);
}

export function isMeetingProjectionFresh(ctx: MesaRuntimeContext, meetingId: string): boolean {
  const proj = _getMeetingProjection(ctx, meetingId, { strict: false });
  if (!proj) return false;
  const lastSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
  if (lastSeq === undefined) return false;
  return lastSeq >= maxEventSequence(ctx, meetingId);
}

export function isAgentProjectionFresh(ctx: MesaRuntimeContext, agentId: string): boolean {
  const proj = _getAgentProjection(ctx, agentId, { strict: false });
  if (!proj) return false;
  const lastSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
  if (lastSeq === undefined) return false;
  return lastSeq >= maxEventSequence(ctx, agentId);
}
