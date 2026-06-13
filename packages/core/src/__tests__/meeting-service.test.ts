import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  addAgentToMeeting,
  addTaskToMeeting,
  createMeeting,
  getMeeting,
  listMeetings,
  updateMeetingStatus,
} from '../services/meeting-service.js';
import { MeetingNotFoundError } from '../errors.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('meeting service', () => {
  it('creates, gets, and lists meetings', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });

    expect(meeting.id).toMatch(/^meeting_/);
    expect(meeting.status).toBe('open');
    expect(getMeeting(ctx, meeting.id).title).toBe('Feature Review');
    expect(listMeetings(ctx)).toHaveLength(1);
  });

  it('throws for missing meetings', () => {
    expect(() => getMeeting(ctx, 'meeting_missing')).toThrow(MeetingNotFoundError);
  });

  it('updates status and membership', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    const active = updateMeetingStatus(ctx, meeting.id, 'active');
    const withTask = addTaskToMeeting(ctx, meeting.id, 'task_12345678');
    const withAgent = addAgentToMeeting(ctx, meeting.id, 'agent:codex');

    expect(active.status).toBe('active');
    expect(withTask.tasks).toContain('task_12345678');
    expect(withAgent.agents).toContain('agent:codex');
  });

  it('records meeting events with runtime actor', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    updateMeetingStatus(ctx, meeting.id, 'active');
    addTaskToMeeting(ctx, meeting.id, 'task_12345678');
    addAgentToMeeting(ctx, meeting.id, 'agent:codex');

    const events = ctx.eventStore.list({ streamId: meeting.id });
    expect(events.map((event) => event.type)).toEqual([
      'meeting_created',
      'meeting_status_changed',
      'meeting_task_added',
      'meeting_agent_added',
    ]);
    expect(events.every((event) => event.actor === 'user:test')).toBe(true);
  });

  it('rejects meeting mutation denied by policy', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:blocked', type: 'agent', roles: ['reviewer'] },
      policy: { can: () => ({ allowed: false, reason: 'blocked' }), canWithContext: () => ({ allowed: false, reason: 'blocked' }) },
    });

    expect(() => createMeeting(deniedCtx, { title: 'Blocked' })).toThrow(
      'Policy denied'
    );
  });
});
