import { join } from 'node:path';
import {
  MesaMeetingSchema,
  CreateMeetingInputSchema,
  currentProtocolVersion,
  generateMeetingId,
} from '@agentmesa/protocol';
import type { MesaMeeting, CreateMeetingInput, MeetingStatus, MeetingTrustLevel } from '@agentmesa/protocol';
import { InvalidStatusTransitionError, MeetingNotFoundError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export function createMeeting(ctx: MesaRuntimeContext, input: CreateMeetingInput): MesaMeeting {
  assertPolicy(ctx, 'meeting.create', 'meeting');
  const validated = CreateMeetingInputSchema.parse(input);

  const now = new Date().toISOString();
  const meeting: MesaMeeting = {
    protocolVersion: currentProtocolVersion,
    id: generateMeetingId(),
    title: validated.title,
    status: 'open',
    trustLevel: validated.trustLevel ?? 'approval',
    tasks: validated.tasks ?? [],
    agents: validated.agents ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const result = MesaMeetingSchema.parse(meeting);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: result.id,
    type: 'meeting_created',
    streamId: result.id,
    streamType: 'meeting',
    data: { meeting: result },
  });

  return result;
}

export function getMeeting(ctx: MesaRuntimeContext, meetingId: string): MesaMeeting {
  const meeting = readJsonFromStorage<MesaMeeting>(
    ctx,
    join(ctx.paths.meetingsDir, `${meetingId}.json`)
  );
  if (!meeting) {
    throw new MeetingNotFoundError(meetingId);
  }
  return MesaMeetingSchema.parse(meeting);
}

export function listMeetings(ctx: MesaRuntimeContext): MesaMeeting[] {
  return listJsonFromStorage<MesaMeeting>(ctx, ctx.paths.meetingsDir)
    .map((m) => MesaMeetingSchema.safeParse(m))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaMeeting }).data);
}

export function updateMeetingStatus(
  ctx: MesaRuntimeContext,
  meetingId: string,
  status: MeetingStatus
): MesaMeeting {
  assertPolicy(ctx, 'meeting.updateStatus', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if (!canTransitionMeetingStatus(meeting.status, status)) {
    throw new InvalidStatusTransitionError(meeting.status, status);
  }

  const updated: MesaMeeting = {
    ...meeting,
    status,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'meeting_status_changed',
    streamId: meetingId,
    streamType: 'meeting',
    data: { oldStatus: meeting.status, newStatus: status },
  });

  return result;
}

/**
 * Update the meeting's trust level. Unlike status, the trust level is not a
 * lifecycle — it is a human-set posture switch and may flip freely in both
 * directions (no transition table). Setting the same level is idempotent:
 * no write, no event. Blocked-pattern and secret-path protection apply at
 * BOTH levels; `trusted` only lifts the per-action human-approval fence for
 * session speech turns (writes are then judged by role capabilities).
 */
export function updateMeetingTrustLevel(
  ctx: MesaRuntimeContext,
  meetingId: string,
  trustLevel: MeetingTrustLevel
): MesaMeeting {
  assertPolicy(ctx, 'meeting.updateTrustLevel', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if (meeting.trustLevel === trustLevel) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    trustLevel,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'meeting_trust_level_changed',
    streamId: meetingId,
    streamType: 'meeting',
    data: { oldTrustLevel: meeting.trustLevel, newTrustLevel: trustLevel },
  });

  return result;
}

/**
 * Toggle the auto-refresh flag on an imported meeting's metadata. When on,
 * the desk watches the source transcript and runs an incremental refresh
 * when it grows (snapshot P2). Deliberately a plain metadata flag with no
 * dedicated event: it is a low-sensitivity convenience switch, not a trust
 * posture (contrast `updateMeetingTrustLevel`). Import sessions under active
 * takeover (adopted) should NOT enable it — the driver's own turns keep
 * growing the source, and re-syncing them would duplicate the write-back
 * bubbles.
 */
export function setMeetingAutoRefresh(
  ctx: MesaRuntimeContext,
  meetingId: string,
  enabled: boolean
): MesaMeeting {
  assertPolicy(ctx, 'meeting.updateAutoRefresh', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if ((meeting.metadata?.['autoRefresh'] === true) === enabled) {
    return meeting;
  }

  const metadata = { ...(meeting.metadata ?? {}), autoRefresh: enabled };
  const updated: MesaMeeting = {
    ...meeting,
    metadata,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);
  return result;
}

export function addTaskToMeeting(
  ctx: MesaRuntimeContext,
  meetingId: string,
  taskId: string
): MesaMeeting {
  assertPolicy(ctx, 'meeting.addTask', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if (meeting.tasks.includes(taskId)) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    tasks: [...meeting.tasks, taskId],
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'meeting_task_added',
    streamId: meetingId,
    streamType: 'meeting',
    data: { taskId },
  });

  return result;
}

export function addAgentToMeeting(
  ctx: MesaRuntimeContext,
  meetingId: string,
  agentId: string
): MesaMeeting {
  assertPolicy(ctx, 'meeting.addAgent', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if (meeting.agents.includes(agentId)) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    agents: [...meeting.agents, agentId],
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'meeting_agent_added',
    streamId: meetingId,
    streamType: 'meeting',
    data: { agentId },
  });

  return result;
}

export function removeAgentFromMeeting(
  ctx: MesaRuntimeContext,
  meetingId: string,
  agentId: string
): MesaMeeting {
  assertPolicy(ctx, 'meeting.removeAgent', `meeting:${meetingId}`);
  const meeting = getMeeting(ctx, meetingId);

  if (!meeting.agents.includes(agentId)) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    agents: meeting.agents.filter((id) => id !== agentId),
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeMeeting(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId,
    type: 'meeting_agent_removed',
    streamId: meetingId,
    streamType: 'meeting',
    data: { agentId },
  });

  return result;
}

/** Meeting status transitions allowed by the state machine. */
export function canTransitionMeetingStatus(
  from: MeetingStatus,
  to: MeetingStatus,
): boolean {
  if (from === to) return true;
  switch (from) {
    case 'open':
      return to === 'active' || to === 'paused' || to === 'completed' || to === 'archived' || to === 'closed';
    case 'active':
      return to === 'paused' || to === 'completed' || to === 'archived' || to === 'closed';
    case 'paused':
      return to === 'active' || to === 'completed' || to === 'archived' || to === 'closed';
    case 'planning':
      return to === 'active' || to === 'archived' || to === 'closed';
    case 'completed':
    case 'archived':
    case 'closed':
      return false; // terminal — immutable
    default:
      return false;
  }
}

function writeMeeting(ctx: MesaRuntimeContext, meeting: MesaMeeting): void {
  writeJsonToStorage(
    ctx,
    join(ctx.paths.meetingsDir, `${meeting.id}.json`),
    meeting
  );
}
