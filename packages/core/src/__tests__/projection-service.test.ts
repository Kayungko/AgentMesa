import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createTask, updateTaskStatus, assignTask, deleteTask } from '../services/task-service.js';
import { createMeeting, updateMeetingStatus, addTaskToMeeting, addAgentToMeeting } from '../services/meeting-service.js';
import { rebuildTaskProjections, rebuildMeetingProjections, rebuildAllProjections } from '../services/projection-service.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

function readProjection(projectionsDir: string, id: string): Record<string, unknown> {
  const raw = readFileSync(join(projectionsDir, `${id}.json`), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function getMeta(proj: Record<string, unknown>): Record<string, unknown> {
  return proj._meta as Record<string, unknown>;
}

function getStringList(proj: Record<string, unknown>, key: string): string[] {
  return (proj[key] as string[]) ?? [];
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-proj-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('rebuildTaskProjections', () => {
  it('rebuilds a task from a single create event', () => {
    const task = createTask(ctx, { title: 'Solo task' });
    const count = rebuildTaskProjections(ctx);
    expect(count).toBe(1);

    const proj = readProjection(ctx.paths.taskProjectionsDir, task.id);
    expect(proj.id).toBe(task.id);
    expect(getMeta(proj).source).toBe('event_rebuild');
    expect(proj.title).toBe('Solo task');
    expect(proj.status).toBe('todo');
  });

  it('replays status changes', () => {
    const task = createTask(ctx, { title: 'Status task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    updateTaskStatus(ctx, task.id, 'ready_for_review');

    rebuildTaskProjections(ctx);
    const proj = readProjection(ctx.paths.taskProjectionsDir, task.id);
    expect(proj.status).toBe('ready_for_review');
    expect(getMeta(proj).lastSequence).toBe(2);
  });

  it('replays assignment', () => {
    const task = createTask(ctx, { title: 'Assign task' });
    assignTask(ctx, task.id, 'agent-claude', 'agent-codex');

    rebuildTaskProjections(ctx);
    const proj = readProjection(ctx.paths.taskProjectionsDir, task.id);
    expect(proj.assignedTo).toBe('agent-claude');
    expect(proj.reviewer).toBe('agent-codex');
  });

  it('generates a tombstone for a deleted task', () => {
    const task = createTask(ctx, { title: 'Gone task' });
    deleteTask(ctx, task.id);

    rebuildTaskProjections(ctx);
    const proj = readProjection(ctx.paths.taskProjectionsDir, task.id);
    expect(proj.deleted).toBe(true);
    expect(proj.deletedAt).toBeDefined();
    expect(proj.id).toBe(task.id);
  });

  it('survives a fresh createRuntimeContext', () => {
    const task = createTask(ctx, { title: 'Persistent' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const ctx2 = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    const count = rebuildTaskProjections(ctx2);
    expect(count).toBe(1);

    const proj = readProjection(ctx2.paths.taskProjectionsDir, task.id);
    expect(proj.status).toBe('in_progress');
  });

  it('returns 0 when there are no task events', () => {
    expect(rebuildTaskProjections(ctx)).toBe(0);
  });

  it('treats auto-created meetings as meetings', () => {
    // createTask auto-creates a meeting, so a meeting projection is expected
    createTask(ctx, { title: 'Task with auto meeting' });
    expect(rebuildMeetingProjections(ctx)).toBe(1);
  });
});

describe('rebuildMeetingProjections', () => {
  it('rebuilds a meeting from create event', () => {
    const meeting = createMeeting(ctx, { title: 'Sprint planning' });
    const count = rebuildMeetingProjections(ctx);
    expect(count).toBe(1);

    const proj = readProjection(ctx.paths.meetingProjectionsDir, meeting.id);
    expect(proj.id).toBe(meeting.id);
    expect(proj.title).toBe('Sprint planning');
    expect(getMeta(proj).source).toBe('event_rebuild');
  });

  it('replays meeting status changes', () => {
    const meeting = createMeeting(ctx, { title: 'Status meeting' });
    updateMeetingStatus(ctx, meeting.id, 'active');
    updateMeetingStatus(ctx, meeting.id, 'closed');

    rebuildMeetingProjections(ctx);
    const proj = readProjection(ctx.paths.meetingProjectionsDir, meeting.id);
    expect(proj.status).toBe('closed');
  });

  it('collects task and agent additions', () => {
    const meeting = createMeeting(ctx, { title: 'Collab meeting' });
    const task = createTask(ctx, { title: 'Agenda item' });
    updateMeetingStatus(ctx, meeting.id, 'active');
    addTaskToMeeting(ctx, meeting.id, task.id);
    addAgentToMeeting(ctx, meeting.id, 'agent-alice');
    addAgentToMeeting(ctx, meeting.id, 'agent-bob');

    rebuildMeetingProjections(ctx);
    const proj = readProjection(ctx.paths.meetingProjectionsDir, meeting.id);
    expect(getStringList(proj, 'taskIds')).toContain(task.id);
    expect(getStringList(proj, 'agentIds')).toContain('agent-alice');
    expect(getStringList(proj, 'agentIds')).toContain('agent-bob');
  });

  it('does not duplicate taskIds or agentIds', () => {
    const meeting = createMeeting(ctx, { title: 'Dedup meeting' });
    addTaskToMeeting(ctx, meeting.id, 'task_abc');
    addTaskToMeeting(ctx, meeting.id, 'task_abc');

    rebuildMeetingProjections(ctx);
    const proj = readProjection(ctx.paths.meetingProjectionsDir, meeting.id);
    expect(getStringList(proj, 'taskIds').filter((id) => id === 'task_abc')).toHaveLength(1);
  });
});

describe('rebuildAllProjections', () => {
  it('rebuilds both task and meeting projections together', () => {
    // each createTask auto-creates a meeting, so 2 tasks + 1 meeting = 3 meetings
    createTask(ctx, { title: 'Task 1' });
    createTask(ctx, { title: 'Task 2' });
    createMeeting(ctx, { title: 'Meeting 1' });

    const result = rebuildAllProjections(ctx);
    expect(result.tasks).toBe(2);
    expect(result.meetings).toBe(3);
  });

  it('returns zero counts for an empty event log', () => {
    const result = rebuildAllProjections(ctx);
    expect(result).toEqual({ tasks: 0, meetings: 0 });
  });
});
