import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  createMeeting,
  registerAgent,
  rebuildAllProjections,
  updateTaskStatus,
} from '../index.js';
import type { MesaRuntimeContext, ReadModelMode } from '../index.js';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import { MesaError } from '../errors.js';
import {
  getTaskReadModel,
  listTaskReadModels,
  getMeetingReadModel,
  listMeetingReadModels,
  getAgentReadModel,
  listAgentReadModels,
} from '../services/read-model-service.js';

let testDirs: string[] = [];

function makeCleanDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'agentmesa-rm-'));
  testDirs.push(d);
  return d;
}

function makeContext(rootDir: string, mode: ReadModelMode = 'hybrid'): MesaRuntimeContext {
  const storage = new FileStorageAdapter();
  initWorkspace(rootDir);
  const configPath = join(rootDir, '.agentmesa', 'config.json');
  storage.writeText(
    configPath,
    JSON.stringify({ protocolVersion: '0.2.0', readModel: { mode } }, null, 2) + '\n',
  );
  return createRuntimeContext({
    rootDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    storage,
  });
}

function switchMode(ctx: MesaRuntimeContext, mode: ReadModelMode): MesaRuntimeContext {
  const configPath = join(ctx.paths.mesaDir, 'config.json');
  const storage = new FileStorageAdapter();
  storage.writeText(
    configPath,
    JSON.stringify({ protocolVersion: '0.2.0', readModel: { mode } }, null, 2) + '\n',
  );
  return createRuntimeContext({
    rootDir: ctx.rootDir,
    actor: ctx.actor,
    storage,
  });
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  for (const d of testDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('read-model-service: tasks (hybrid default)', () => {
  it('returns task from projection when both exist', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Hybrid task' });
    rebuildAllProjections(ctx);

    const result = getTaskReadModel(ctx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
    expect(result!.title).toBe('Hybrid task');
  });

  it('falls back to legacy when no projection exists', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Legacy only' });

    const result = getTaskReadModel(ctx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
  });

  it('returns null for unknown task', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    expect(getTaskReadModel(ctx, 'nonexistent')).toBeNull();
  });

  it('lists tasks from projections when available', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    createTask(ctx, { title: 'Task A' });
    createTask(ctx, { title: 'Task B' });
    rebuildAllProjections(ctx);

    expect(listTaskReadModels(ctx)).toHaveLength(2);
  });

  it('lists tasks from legacy when no projections', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    createTask(ctx, { title: 'Only legacy' });

    const results = listTaskReadModels(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Only legacy');
  });

  it('warns and falls back to legacy when projection corrupted (hybrid mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Hybrid corrupted' });
    rebuildAllProjections(ctx);

    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    ctx.storage.writeText(projPath, 'corrupted json {{{');

    const hybridCtx = createRuntimeContext({
      rootDir: dir,
      actor: ctx.actor,
      storage: ctx.storage,
    });
    const warnSpy = vi.spyOn(hybridCtx.logger, 'warn');

    const result = getTaskReadModel(hybridCtx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
    expect(result!.title).toBe('Hybrid corrupted');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('projection corrupted'));
  });

  it('list warns and falls back when projections corrupted (hybrid mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'List corrupted' });
    rebuildAllProjections(ctx);

    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    ctx.storage.writeText(projPath, 'not valid json at all');

    const hybridCtx = createRuntimeContext({
      rootDir: dir,
      actor: ctx.actor,
      storage: ctx.storage,
    });
    const warnSpy = vi.spyOn(hybridCtx.logger, 'warn');

    const results = listTaskReadModels(hybridCtx);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(task.id);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('projections corrupted'));
  });

  it('warns and falls back when projection missing (hybrid mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Hybrid missing' });

    const warnSpy = vi.spyOn(ctx.logger, 'warn');

    const result = getTaskReadModel(ctx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
    expect(result!.title).toBe('Hybrid missing');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('projection missing'));
  });

  it('warns and falls back when projection stale (hybrid mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Hybrid stale' });
    rebuildAllProjections(ctx);
    updateTaskStatus(ctx, task.id, 'in_progress');

    const warnSpy = vi.spyOn(ctx.logger, 'warn');

    const result = getTaskReadModel(ctx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('projection stale'));
  });
});

describe('read-model-service: meetings (hybrid default)', () => {
  it('returns meeting from projection', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const meeting = createMeeting(ctx, { title: 'Hybrid meeting' });
    rebuildAllProjections(ctx);

    const result = getMeetingReadModel(ctx, meeting.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(meeting.id);
  });

  it('falls back to legacy', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const meeting = createMeeting(ctx, { title: 'Legacy meeting' });

    const result = getMeetingReadModel(ctx, meeting.id);
    expect(result).not.toBeNull();
  });

  it('returns null for unknown meeting', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    expect(getMeetingReadModel(ctx, 'nonexistent')).toBeNull();
  });

  it('lists meetings', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    createMeeting(ctx, { title: 'M1' });
    createMeeting(ctx, { title: 'M2' });
    rebuildAllProjections(ctx);

    expect(listMeetingReadModels(ctx)).toHaveLength(2);
  });
});

describe('read-model-service: agents (hybrid default)', () => {
  it('returns agent from projection', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    registerAgent(ctx, { id: 'claude', name: 'Claude', client: 'claude-code', status: 'available', roles: ['builder'] });
    rebuildAllProjections(ctx);

    const result = getAgentReadModel(ctx, 'claude');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('claude');
  });

  it('falls back to legacy', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    registerAgent(ctx, { id: 'codex', name: 'Codex', client: 'codex', status: 'available', roles: ['reviewer'] });

    const result = getAgentReadModel(ctx, 'codex');
    expect(result).not.toBeNull();
  });

  it('returns null for unknown agent', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    expect(getAgentReadModel(ctx, 'nobody')).toBeNull();
  });

  it('lists agents', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    registerAgent(ctx, { id: 'a1', name: 'A1', client: 'c1', status: 'available', roles: ['builder'] });
    registerAgent(ctx, { id: 'a2', name: 'A2', client: 'c2', status: 'available', roles: ['reviewer'] });
    rebuildAllProjections(ctx);

    expect(listAgentReadModels(ctx)).toHaveLength(2);
  });
});

describe('read-model-service: projection-only mode', () => {
  it('returns projection when it exists', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Proj only' });
    rebuildAllProjections(ctx);

    const projCtx = switchMode(ctx, 'projection');
    const result = getTaskReadModel(projCtx, task.id);
    expect(result).not.toBeNull();
  });

  it('throws MesaError when projection is missing (projection mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'No projection' });

    const projCtx = switchMode(ctx, 'projection');
    expect(() => getTaskReadModel(projCtx, task.id)).toThrow(MesaError);
  });

  it('throws MesaError when projection is stale (projection mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Go stale' });
    rebuildAllProjections(ctx);
    updateTaskStatus(ctx, task.id, 'in_progress');

    const projCtx = switchMode(ctx, 'projection');
    expect(() => getTaskReadModel(projCtx, task.id)).toThrow(MesaError);
  });

  it('lists only projections', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    createTask(ctx, { title: 'P1' });
    createTask(ctx, { title: 'P2' });
    rebuildAllProjections(ctx);

    const projCtx = switchMode(ctx, 'projection');
    expect(listTaskReadModels(projCtx)).toHaveLength(2);
  });

  it('throws MesaError when projection is corrupted (projection mode)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Corrupted' });
    rebuildAllProjections(ctx);

    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    ctx.storage.writeText(projPath, '{ not valid json }');

    const projCtx = switchMode(ctx, 'projection');
    expect(() => getTaskReadModel(projCtx, task.id)).toThrow(MesaError);
  });
});

describe('read-model-service: legacy-only mode', () => {
  it('reads from legacy even when projection exists', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Legacy mode' });
    rebuildAllProjections(ctx);

    const legacyCtx = switchMode(ctx, 'legacy');
    const result = getTaskReadModel(legacyCtx, task.id);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Legacy mode');
  });

  it('lists from legacy', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    createTask(ctx, { title: 'L1' });
    rebuildAllProjections(ctx);

    const legacyCtx = switchMode(ctx, 'legacy');
    expect(listTaskReadModels(legacyCtx)).toHaveLength(1);
  });

  it('does not read projections (corrupted projection does not matter)', () => {
    const dir = makeCleanDir();
    const ctx = makeContext(dir);
    const task = createTask(ctx, { title: 'Legacy untouched' });
    rebuildAllProjections(ctx);

    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    ctx.storage.writeText(projPath, 'garbage {{{');

    const legacyCtx = switchMode(ctx, 'legacy');
    const result = getTaskReadModel(legacyCtx, task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
    expect(result!.title).toBe('Legacy untouched');
  });
});
