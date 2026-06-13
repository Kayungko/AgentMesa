import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createTask } from '../services/task-service.js';
import { createMeeting } from '../services/meeting-service.js';
import { registerAgent } from '../services/agent-registry.js';
import { rebuildAllProjections } from '../services/projection-service.js';
import {
  getTaskProjection,
  getMeetingProjection,
  getAgentProjection,
  listTaskProjections,
  listMeetingProjections,
  listAgentProjections,
} from '../services/projection-read-service.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-proj-read-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('getTaskProjection', () => {
  it('returns a rebuilt task projection', () => {
    const task = createTask(ctx, { title: 'Readable task' });
    rebuildAllProjections(ctx);

    const proj = getTaskProjection(ctx, task.id);
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(task.id);
    expect(proj!.title).toBe('Readable task');
  });

  it('returns null for unknown task id', () => {
    expect(getTaskProjection(ctx, 'nonexistent')).toBeNull();
  });

  it('returns null when projections have not been rebuilt', () => {
    const task = createTask(ctx, { title: 'No rebuild yet' });
    expect(getTaskProjection(ctx, task.id)).toBeNull();
  });
});

describe('getMeetingProjection', () => {
  it('returns a rebuilt meeting projection', () => {
    const meeting = createMeeting(ctx, { title: 'Readable meeting' });
    rebuildAllProjections(ctx);

    const proj = getMeetingProjection(ctx, meeting.id);
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(meeting.id);
    expect(proj!.title).toBe('Readable meeting');
  });

  it('returns null for unknown meeting id', () => {
    expect(getMeetingProjection(ctx, 'nonexistent')).toBeNull();
  });
});

describe('getAgentProjection', () => {
  it('returns a rebuilt agent projection', () => {
    registerAgent(ctx, {
      id: 'agent-reader',
      name: 'Read Agent',
      client: 'claude',
      roles: ['builder'],
      status: 'available',
    });
    rebuildAllProjections(ctx);

    const proj = getAgentProjection(ctx, 'agent-reader');
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe('agent-reader');
    expect(proj!.name).toBe('Read Agent');
  });

  it('returns null for unknown agent id', () => {
    expect(getAgentProjection(ctx, 'nonexistent')).toBeNull();
  });
});

describe('listTaskProjections', () => {
  it('lists all rebuilt task projections', () => {
    createTask(ctx, { title: 'Task A' });
    createTask(ctx, { title: 'Task B' });
    rebuildAllProjections(ctx);

    const list = listTaskProjections(ctx);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.title)).toEqual(expect.arrayContaining(['Task A', 'Task B']));
  });

  it('returns empty array when no rebuild has run', () => {
    createTask(ctx, { title: 'Unbuilt' });
    expect(listTaskProjections(ctx)).toEqual([]);
  });
});

describe('listMeetingProjections', () => {
  it('lists all rebuilt meeting projections', () => {
    createMeeting(ctx, { title: 'Meeting X' });
    createMeeting(ctx, { title: 'Meeting Y' });
    rebuildAllProjections(ctx);

    const list = listMeetingProjections(ctx);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no rebuild has run', () => {
    createMeeting(ctx, { title: 'Unbuilt' });
    expect(listMeetingProjections(ctx)).toEqual([]);
  });
});

describe('listAgentProjections', () => {
  it('lists all rebuilt agent projections', () => {
    registerAgent(ctx, { id: 'agent-1', name: 'A1', client: 'claude', roles: ['reviewer'], status: 'available' });
    registerAgent(ctx, { id: 'agent-2', name: 'A2', client: 'codex', roles: ['builder'], status: 'available' });
    rebuildAllProjections(ctx);

    const list = listAgentProjections(ctx);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no rebuild has run', () => {
    registerAgent(ctx, { id: 'agent-99', name: 'A99', client: 'claude', roles: ['reviewer'], status: 'available' });
    expect(listAgentProjections(ctx)).toEqual([]);
  });
});
