import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  createMeeting,
  listMeetings,
  registerAgent,
  listAgents,
  rebuildAllProjections,
} from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { runTimeline } from '../commands/events.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('CLI integration: task workflow', () => {
  it('creates and lists tasks', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    expect(task.id).toMatch(/^task_/);

    const tasks = listTasks(ctx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Build feature');
  });

  it('updates task status through lifecycle', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = updateTaskStatus(ctx, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');

    const fetched = getTask(ctx, task.id);
    expect(fetched.status).toBe('in_progress');
  });

  it('registers and lists agents', () => {
    registerAgent(ctx, { id: 'claude', name: 'Claude Code', client: 'claude-code', status: 'available', roles: ['builder'] });
    registerAgent(ctx, { id: 'codex', name: 'Codex', client: 'codex', status: 'available', roles: ['reviewer'] });

    const agents = listAgents(ctx);
    expect(agents).toHaveLength(2);
  });

  it('creates meetings', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    expect(meeting.id).toMatch(/^meeting_/);
    expect(meeting.status).toBe('open');

    const meetings = listMeetings(ctx);
    expect(meetings).toHaveLength(1);
  });
});

describe('CLI integration: workspace init', () => {
  it('workspace directories exist after init', () => {
    expect(existsSync(paths.mesaDir)).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.meetingsDir)).toBe(true);
    expect(existsSync(join(paths.mesaDir, 'config.json'))).toBe(true);
  });

  it('config.json has correct protocol version', () => {
    const config = JSON.parse(readFileSync(join(paths.mesaDir, 'config.json'), 'utf-8'));
    expect(config.protocolVersion).toBe('0.2.0');
  });
});

describe('CLI integration: timeline subcommands', () => {
  it('task timeline has task events and projection', async () => {
    const task = createTask(ctx, { title: 'Timeline task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    rebuildAllProjections(ctx);

    const { getTaskEvents, getTaskProjection } = await import('@agentmesa/core');
    const events = getTaskEvents(ctx, task.id);
    const proj = getTaskProjection(ctx, task.id);

    expect(events.length).toBeGreaterThanOrEqual(2); // task_created + task_status_changed
    expect(events[0]!.type).toBe('task_created');
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(task.id);
    expect(proj!.status).toBe('in_progress');
  });

  it('meeting timeline has meeting events and projection', async () => {
    const meeting = createMeeting(ctx, { title: 'Timeline meeting' });
    rebuildAllProjections(ctx);

    const { getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');
    const events = getMeetingEvents(ctx, meeting.id);
    const proj = getMeetingProjection(ctx, meeting.id);

    expect(events.length).toBeGreaterThanOrEqual(1); // meeting_created
    expect(events[0]!.type).toBe('meeting_created');
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(meeting.id);
    expect(proj!.title).toBe('Timeline meeting');
  });

  it('unknown task id returns empty events and null projection', async () => {
    const { getTaskEvents, getTaskProjection } = await import('@agentmesa/core');
    const events = getTaskEvents(ctx, 'nonexistent');
    const proj = getTaskProjection(ctx, 'nonexistent');

    expect(events).toEqual([]);
    expect(proj).toBeNull();
  });

  it('unknown meeting id returns empty events and null projection', async () => {
    const { getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');
    const events = getMeetingEvents(ctx, 'nonexistent');
    const proj = getMeetingProjection(ctx, 'nonexistent');

    expect(events).toEqual([]);
    expect(proj).toBeNull();
  });
});
