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
  canTransitionMeetingStatus,
  createMeeting,
  getMeeting,
  listMeetings,
  removeAgentFromMeeting,
  updateMeetingStatus,
} from '../services/meeting-service.js';
import { InvalidStatusTransitionError, MeetingNotFoundError } from '../errors.js';

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

  it('enforces the meeting status state machine', () => {
    // open → active / paused / completed / archived / closed
    expect(canTransitionMeetingStatus('open', 'active')).toBe(true);
    expect(canTransitionMeetingStatus('open', 'paused')).toBe(true);
    expect(canTransitionMeetingStatus('open', 'completed')).toBe(true);
    expect(canTransitionMeetingStatus('open', 'archived')).toBe(true);
    expect(canTransitionMeetingStatus('open', 'closed')).toBe(true);

    // paused ↔ active
    expect(canTransitionMeetingStatus('paused', 'active')).toBe(true);
    expect(canTransitionMeetingStatus('active', 'paused')).toBe(true);

    // terminal states are immutable
    expect(canTransitionMeetingStatus('completed', 'active')).toBe(false);
    expect(canTransitionMeetingStatus('archived', 'active')).toBe(false);
    expect(canTransitionMeetingStatus('closed', 'open')).toBe(false);

    // same status is a no-op
    expect(canTransitionMeetingStatus('active', 'active')).toBe(true);
  });

  it('throws InvalidStatusTransitionError on illegal meeting status change', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    updateMeetingStatus(ctx, meeting.id, 'completed');

    expect(() => updateMeetingStatus(ctx, meeting.id, 'active')).toThrow(
      InvalidStatusTransitionError
    );
  });

  it('removes an agent from a meeting and emits meeting_agent_removed', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    addAgentToMeeting(ctx, meeting.id, 'agent:codex');
    addAgentToMeeting(ctx, meeting.id, 'agent:claude');

    const result = removeAgentFromMeeting(ctx, meeting.id, 'agent:codex');

    expect(result.agents).not.toContain('agent:codex');
    expect(result.agents).toContain('agent:claude');

    const events = ctx.eventStore.list({ streamId: meeting.id });
    expect(events.at(-1)?.type).toBe('meeting_agent_removed');
  });

  it('is idempotent when removing an absent agent', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    const result = removeAgentFromMeeting(ctx, meeting.id, 'agent:nobody');

    expect(result.agents).toHaveLength(0);
    const events = ctx.eventStore.list({ streamId: meeting.id });
    expect(events.map((event) => event.type)).not.toContain('meeting_agent_removed');
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
