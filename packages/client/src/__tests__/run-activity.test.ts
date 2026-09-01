import { describe, it, expect } from 'vitest';
import type { EventEnvelope } from '@agentmesa/protocol';
import { collectRunActivity, runActivityFromProgress } from '../run-activity.js';

function envelope(input: {
  cursor: string;
  meetingId: string;
  type?: string;
  stage?: string;
  message?: string;
}): EventEnvelope {
  return {
    cursor: input.cursor,
    event: {
      protocolVersion: '0.2.0',
      id: `event_${input.cursor}`,
      meetingId: input.meetingId,
      type: (input.type ?? 'agent_run_progress') as EventEnvelope['event']['type'],
      streamId: 'run_x',
      streamType: 'agent_run',
      data: { stage: input.stage, message: input.message },
      actor: 'agent:test',
      sequence: 0,
      timestamp: '2026-08-30T12:00:00.000Z',
    },
  } as unknown as EventEnvelope;
}

describe('runActivityFromProgress', () => {
  it('maps driver_session to the driver name', () => {
    expect(runActivityFromProgress('driver_session', 'Executing deep-driver turn via claude-agent-sdk')).toEqual({
      kind: 'driver',
      label: '经 claude-agent-sdk 深度驱动',
    });
  });

  it('maps permission verdicts', () => {
    expect(runActivityFromProgress('permission_denied', 'tool: Write')).toEqual({
      kind: 'permission_denied',
      label: '权限拒绝：tool: Write',
    });
    expect(runActivityFromProgress('permission_granted', 'command: git status')).toEqual({
      kind: 'permission_granted',
      label: '权限放行：command: git status',
    });
  });

  it('maps the failed stage (e.g. strict-resume takeover failure)', () => {
    expect(runActivityFromProgress('failed', 'strict resume failed for agent "agent:codex-external"')).toEqual({
      kind: 'failed',
      label: '运行失败：strict resume failed for agent "agent:codex-external"',
    });
  });

  it('ignores runner-internal stages', () => {
    expect(runActivityFromProgress('started', 'Run started')).toBeUndefined();
    expect(runActivityFromProgress('runner_invoked', 'Invoking session')).toBeUndefined();
    // The pre-decision request stage duplicates the verdict lines.
    expect(runActivityFromProgress('permission_request', 'tool: Write')).toBeUndefined();
  });
});

describe('collectRunActivity', () => {
  it('keeps only this meeting audit events, oldest → newest', () => {
    const events = [
      envelope({ cursor: 'c1', meetingId: 'meeting_a', stage: 'started', message: 'Run started' }),
      envelope({ cursor: 'c2', meetingId: 'meeting_b', stage: 'permission_denied', message: 'tool: Write' }),
      envelope({ cursor: 'c3', meetingId: 'meeting_a', stage: 'driver_session', message: 'Executing deep-driver turn via claude-agent-sdk' }),
      envelope({ cursor: 'c4', meetingId: 'meeting_a', stage: 'permission_denied', message: 'patch: it_1' }),
      envelope({ cursor: 'c5', meetingId: 'meeting_a', type: 'task_created' }),
    ];
    const items = collectRunActivity(events, 'meeting_a');
    expect(items.map((item) => item.id)).toEqual(['c3', 'c4']);
    expect(items[0]).toMatchObject({ kind: 'driver', label: '经 claude-agent-sdk 深度驱动' });
    expect(items[1]).toMatchObject({ kind: 'permission_denied', label: '权限拒绝：patch: it_1' });
  });

  it('caps the tail at the limit', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      envelope({ cursor: `c${i}`, meetingId: 'meeting_a', stage: 'permission_denied', message: `tool: W${i}` }),
    );
    expect(collectRunActivity(events, 'meeting_a', 20)).toHaveLength(20);
    expect(collectRunActivity(events, 'meeting_a', 20)[0]?.id).toBe('c10');
  });
});
