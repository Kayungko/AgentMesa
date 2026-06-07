import { join } from 'node:path';
import {
  MesaMeetingSchema,
  CreateMeetingInputSchema,
  currentProtocolVersion,
  generateMeetingId,
} from '@agentmesa/protocol';
import type { MesaMeeting, CreateMeetingInput, MeetingStatus } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import { readJson, writeJson, listJson } from '../storage.js';
import { MeetingNotFoundError } from '../errors.js';

export function createMeeting(paths: MesaWorkspacePaths, input: CreateMeetingInput): MesaMeeting {
  const validated = CreateMeetingInputSchema.parse(input);

  const now = new Date().toISOString();
  const meeting: MesaMeeting = {
    protocolVersion: currentProtocolVersion,
    id: generateMeetingId(),
    title: validated.title,
    status: 'open',
    tasks: validated.tasks ?? [],
    agents: validated.agents ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const result = MesaMeetingSchema.parse(meeting);
  writeJson(join(paths.meetingsDir, `${meeting.id}.json`), result);

  return result;
}

export function getMeeting(paths: MesaWorkspacePaths, meetingId: string): MesaMeeting {
  const meeting = readJson<MesaMeeting>(join(paths.meetingsDir, `${meetingId}.json`));
  if (!meeting) {
    throw new MeetingNotFoundError(meetingId);
  }
  return MesaMeetingSchema.parse(meeting);
}

export function listMeetings(paths: MesaWorkspacePaths): MesaMeeting[] {
  return listJson<MesaMeeting>(paths.meetingsDir)
    .map((m) => MesaMeetingSchema.safeParse(m))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaMeeting }).data);
}

export function updateMeetingStatus(
  paths: MesaWorkspacePaths,
  meetingId: string,
  status: MeetingStatus
): MesaMeeting {
  const meeting = getMeeting(paths, meetingId);

  const updated: MesaMeeting = {
    ...meeting,
    status,
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeJson(join(paths.meetingsDir, `${meetingId}.json`), result);

  return result;
}

export function addTaskToMeeting(
  paths: MesaWorkspacePaths,
  meetingId: string,
  taskId: string
): MesaMeeting {
  const meeting = getMeeting(paths, meetingId);

  if (meeting.tasks.includes(taskId)) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    tasks: [...meeting.tasks, taskId],
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeJson(join(paths.meetingsDir, `${meetingId}.json`), result);

  return result;
}

export function addAgentToMeeting(
  paths: MesaWorkspacePaths,
  meetingId: string,
  agentId: string
): MesaMeeting {
  const meeting = getMeeting(paths, meetingId);

  if (meeting.agents.includes(agentId)) {
    return meeting;
  }

  const updated: MesaMeeting = {
    ...meeting,
    agents: [...meeting.agents, agentId],
    updatedAt: new Date().toISOString(),
  };

  const result = MesaMeetingSchema.parse(updated);
  writeJson(join(paths.meetingsDir, `${meetingId}.json`), result);

  return result;
}
