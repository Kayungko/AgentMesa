import type { EventEnvelope } from '@agentmesa/protocol';

/**
 * Meeting-stream activity derived from `agent_run_progress` events: how each
 * session run was driven (deep driver vs CLI) and every permission decision
 * the guard made. COLLAB_VISION treats auditability as the moat — an
 * unshown decision is one that never happened.
 */
export interface RunActivityItem {
  /** Event cursor (stable per event, used as the React key). */
  id: string;
  kind: 'driver' | 'permission_denied' | 'permission_granted' | 'failed';
  /** Human-readable line, e.g. `经 claude-agent-sdk 深度驱动` / `权限拒绝：tool: Write`. */
  label: string;
  timestamp: string;
}

/** Map a progress stage + message onto an activity item, or undefined when the stage is not audit-worthy. */
export function runActivityFromProgress(
  stage: string,
  message: string,
): { kind: RunActivityItem['kind']; label: string } | undefined {
  if (stage === 'driver_session') {
    // message: `Executing deep-driver turn via <driver name>`
    const driver = message.split('via').pop()?.trim() || 'deep driver';
    return { kind: 'driver', label: `经 ${driver} 深度驱动` };
  }
  if (stage === 'permission_denied') {
    return { kind: 'permission_denied', label: `权限拒绝：${message}` };
  }
  if (stage === 'permission_granted') {
    return { kind: 'permission_granted', label: `权限放行：${message}` };
  }
  if (stage === 'failed') {
    // Failure stage from executeRun (e.g. a strict-resume takeover failure).
    // Without this the failure is invisible in the meeting timeline — the
    // run state and error live only in the status drawer.
    return { kind: 'failed', label: `运行失败：${message}` };
  }
  return undefined;
}

/**
 * Collect audit-worthy run activity for one meeting from the live event
 * stream (oldest → newest). Progress events carry
 * `event.meetingId === <meeting>` for session runs; task-run progress is
 * scoped to the task and naturally excluded.
 */
export function collectRunActivity(
  events: EventEnvelope[],
  meetingId: string,
  limit = 20,
): RunActivityItem[] {
  const items: RunActivityItem[] = [];
  for (const envelope of events) {
    const event = envelope.event;
    if (event.meetingId !== meetingId) continue;
    if (event.type !== 'agent_run_progress') continue;
    const data = event.data as { stage?: unknown; message?: unknown } | undefined;
    const stage = typeof data?.stage === 'string' ? data.stage : '';
    const message = typeof data?.message === 'string' ? data.message : '';
    const activity = runActivityFromProgress(stage, message);
    if (activity) {
      items.push({ id: envelope.cursor, timestamp: event.timestamp, ...activity });
    }
  }
  return items.slice(-limit);
}
