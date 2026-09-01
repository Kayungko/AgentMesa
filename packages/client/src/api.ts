import type { EventEnvelope, MesaAgent, MesaMeeting, MesaMessage, MesaRoom, MesaTask, MesaWorkspace } from '@agentmesa/protocol';
import type {
  ExternalSessionPreviewItem,
  ExternalSessionSource,
  ExternalSessionSummary,
  ImportSessionResult,
  MeetingDetail,
  PendingPermissionApproval,
  RoomDetail,
  RuntimeConfig,
  WorkflowState,
  WorkspaceList,
} from './types.js';

function headers(config: RuntimeConfig, json = false): HeadersInit {
  return {
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function request<T>(config: RuntimeConfig, path: string): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, { headers: headers(config) });
  if (!response.ok) {
    throw new Error(`Desk request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function loadRuns(config: RuntimeConfig) {
  return request<import('@agentmesa/protocol').MesaAgentRun[]>(config, '/api/runs');
}

export function loadWorkflows(config: RuntimeConfig) {
  return request<WorkflowState[]>(config, '/api/workflows');
}

// --- Driver permission approvals (desk askHuman bridge) ---

export function listPendingPermissions(config: RuntimeConfig): Promise<{ pending: PendingPermissionApproval[] }> {
  return request<{ pending: PendingPermissionApproval[] }>(config, '/api/permissions/pending');
}

export function decidePermission(
  config: RuntimeConfig,
  id: string,
  decision: 'allow' | 'deny',
): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(
    config,
    `/api/permissions/${encodeURIComponent(id)}/decide`,
    { decision },
  );
}

export function loadEvents(config: RuntimeConfig, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=500` : '?limit=500';
  return request<EventEnvelope[]>(config, `/api/events${query}`);
}

export async function decideWorkflow(
  config: RuntimeConfig,
  workflowId: string,
  decision: 'approve' | 'reject',
  message?: string,
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/decision`, {
    method: 'POST',
    headers: headers(config, true),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      decision,
      ...(decision === 'reject' ? { reason: message || 'Rejected from desktop widget' } : {}),
      ...(message ? { message } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new Error(body.error ?? `Decision failed (${response.status})`);
  }
}

export function createEventStream(
  config: RuntimeConfig,
  cursor: string | undefined,
  onEvent: (event: EventEnvelope) => void,
  onOpen: () => void,
  onError: () => void,
): EventSource {
  const params = new URLSearchParams();
  if (config.token) params.set('access_token', config.token);
  if (cursor) params.set('cursor', cursor);
  const stream = new EventSource(`${config.baseUrl}/api/events/stream?${params}`);
  stream.addEventListener('open', onOpen);
  stream.addEventListener('error', onError);
  stream.addEventListener('mesa-event', (raw) => {
    onEvent(JSON.parse((raw as MessageEvent<string>).data) as EventEnvelope);
  });
  return stream;
}

export interface RoomStreamEvent {
  roomId: string;
  message: import('@agentmesa/protocol').RoomMessage;
}

/** Live room-message stream (global store has no per-workspace event log). */
export function createRoomEventStream(
  config: RuntimeConfig,
  onEvent: (event: RoomStreamEvent) => void,
  onOpen: () => void,
  onError: () => void,
): EventSource {
  const params = new URLSearchParams();
  if (config.token) params.set('access_token', config.token);
  const stream = new EventSource(`${config.baseUrl}/api/rooms/events/stream?${params}`);
  stream.addEventListener('open', onOpen);
  stream.addEventListener('error', onError);
  stream.addEventListener('room-event', (raw) => {
    onEvent(JSON.parse((raw as MessageEvent<string>).data) as RoomStreamEvent);
  });
  return stream;
}

// --- Setup / deployment ---

export type IntegrationSide = 'claude' | 'codex';
export type RunnerSource = 'env' | 'config' | 'stub';

export interface SetupStatus {
  claude: { cliAvailable: boolean; mcpInstalled: boolean };
  codex: { cliAvailable: boolean; mcpInstalled: boolean };
  runners: { claudeCmd?: string; codexCmd?: string };
  runnerSources: Record<IntegrationSide, RunnerSource>;
}

export function loadSetupStatus(config: RuntimeConfig) {
  return request<SetupStatus>(config, '/api/setup/status');
}

async function postJson<T>(config: RuntimeConfig, path: string, body: unknown, method: string = 'POST'): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: headers(config, true),
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await response.json().catch(() => undefined)) as
    | { error?: string; output?: string }
    | undefined;
  if (!response.ok) {
    throw new Error(parsed?.error ?? parsed?.output ?? `Request failed (${response.status})`);
  }
  return parsed as T;
}

export function installIntegration(config: RuntimeConfig, side: IntegrationSide) {
  return postJson<{ ok: boolean; output: string }>(config, '/api/setup/install', { side });
}

export function uninstallIntegration(config: RuntimeConfig, side: IntegrationSide) {
  return postJson<{ ok: boolean; output: string }>(config, '/api/setup/uninstall', { side });
}

export function saveRunnerCommands(
  config: RuntimeConfig,
  patch: { claudeCmd?: string | null; codexCmd?: string | null },
) {
  return postJson<SetupStatus['runners']>(config, '/api/setup/runners', patch);
}

// --- Workspaces ---

export function loadWorkspaces(config: RuntimeConfig): Promise<WorkspaceList> {
  return request<WorkspaceList>(config, '/api/workspaces');
}

export function registerWorkspace(
  config: RuntimeConfig,
  input: { rootDir: string; name?: string },
): Promise<MesaWorkspace> {
  return postJson<MesaWorkspace>(config, '/api/workspaces', input);
}

export function activateWorkspace(config: RuntimeConfig, workspaceId: string): Promise<MesaWorkspace & { switched: boolean }> {
  return postJson<MesaWorkspace & { switched: boolean }>(
    config,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/activate`,
    {},
  );
}

export function removeWorkspace(config: RuntimeConfig, workspaceId: string): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(
    config,
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
    {},
    'DELETE',
  );
}

export function loadWorkspaceMeetings(config: RuntimeConfig, workspaceId: string): Promise<MesaMeeting[]> {
  return request<MesaMeeting[]>(config, `/api/workspaces/${encodeURIComponent(workspaceId)}/meetings`);
}

export function loadWorkspaceAgents(config: RuntimeConfig, workspaceId: string): Promise<MesaAgent[]> {
  return request<MesaAgent[]>(config, `/api/workspaces/${encodeURIComponent(workspaceId)}/agents`);
}

// --- Rooms (cross-workspace group chat) ---

export type RoomSummary = MesaRoom & {
  lastMessageId?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
};

export function loadRooms(config: RuntimeConfig): Promise<RoomSummary[]> {
  return request<RoomSummary[]>(config, '/api/rooms');
}

export function loadRoom(config: RuntimeConfig, roomId: string): Promise<RoomDetail> {
  return request<RoomDetail>(config, `/api/rooms/${encodeURIComponent(roomId)}`);
}

export function createRoom(config: RuntimeConfig, input: { name: string; purpose?: string }): Promise<MesaRoom> {
  return postJson<MesaRoom>(config, '/api/rooms', input);
}

export function inviteRoomMember(
  config: RuntimeConfig,
  roomId: string,
  input: { workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string; label?: string },
): Promise<MesaRoom> {
  return postJson<MesaRoom>(config, `/api/rooms/${encodeURIComponent(roomId)}/members`, input);
}

export function leaveRoomMember(
  config: RuntimeConfig,
  roomId: string,
  input: { workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string },
): Promise<MesaRoom> {
  return postJson<MesaRoom>(config, `/api/rooms/${encodeURIComponent(roomId)}/leave`, input);
}

export function sendRoomMessage(
  config: RuntimeConfig,
  roomId: string,
  input: {
    workspaceId: string;
    from: { workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string; label?: string };
    summary: string;
    type?: string;
    /** M2 协作语义：被 @ 成员的 ref 列表。 */
    mentions?: string[];
    /** M2 协作语义：发送者角色（如 planner/builder）。 */
    senderRole?: string;
    /** M2 协作语义：人类操作者发送时为 'human'。 */
    origin?: 'human' | 'agent';
  },
): Promise<import('@agentmesa/protocol').RoomMessage> {
  return postJson<import('@agentmesa/protocol').RoomMessage>(
    config,
    `/api/rooms/${encodeURIComponent(roomId)}/messages`,
    input,
  );
}

// --- Sessions / meetings ---

export function loadMeetings(config: RuntimeConfig): Promise<MesaMeeting[]> {
  return request<MesaMeeting[]>(config, '/api/meetings');
}

export function loadMeeting(config: RuntimeConfig, meetingId: string): Promise<MeetingDetail> {
  return request<MeetingDetail>(config, `/api/meetings/${encodeURIComponent(meetingId)}`);
}

export function loadAgents(config: RuntimeConfig): Promise<MesaAgent[]> {
  return request<MesaAgent[]>(config, '/api/agents');
}

export function registerAgent(
  config: RuntimeConfig,
  input: { id: string; name: string; client: string; roles: string[]; clientId?: string; workspaceId?: string },
): Promise<MesaAgent> {
  return postJson<MesaAgent>(config, '/api/agents', input);
}

export function loadTasks(config: RuntimeConfig): Promise<MesaTask[]> {
  return request<MesaTask[]>(config, '/api/tasks');
}

export function loadArtifacts(config: RuntimeConfig): Promise<import('@agentmesa/protocol').MesaArtifact[]> {
  return request<import('@agentmesa/protocol').MesaArtifact[]>(config, '/api/artifacts');
}

export function createMeeting(
  config: RuntimeConfig,
  input: { title: string; purpose?: string; agents?: string[] },
): Promise<MesaMeeting> {
  return postJson<MesaMeeting>(config, '/api/meetings', input);
}

export function addMeetingAgent(
  config: RuntimeConfig,
  meetingId: string,
  agentId: string,
): Promise<MesaMeeting> {
  return postJson<MesaMeeting>(
    config,
    `/api/meetings/${encodeURIComponent(meetingId)}/agents`,
    { agentId },
  );
}

export function removeMeetingAgent(config: RuntimeConfig, meetingId: string, agentId: string): Promise<MesaMeeting> {
  return postJson<MesaMeeting>(
    config,
    `/api/meetings/${encodeURIComponent(meetingId)}/agents/${encodeURIComponent(agentId)}`,
    {},
    'DELETE',
  );
}

export function updateRunStatus(
  config: RuntimeConfig,
  runId: string,
  input: { status: string; output?: string; error?: string },
): Promise<import('@agentmesa/protocol').MesaAgentRun> {
  return postJson<import('@agentmesa/protocol').MesaAgentRun>(
    config,
    `/api/runs/${encodeURIComponent(runId)}/status`,
    input,
  );
}

export function postMeetingMessage(
  config: RuntimeConfig,
  input: { meetingId: string; summary: string; type?: string },
): Promise<MesaMessage> {
  return postJson<MesaMessage>(config, '/api/messages', {
    meetingId: input.meetingId,
    summary: input.summary,
    type: input.type ?? 'general',
  });
}

export function updateMeetingStatus(config: RuntimeConfig, meetingId: string, status: string): Promise<MesaMeeting> {
  return postJson<MesaMeeting>(
    config,
    `/api/meetings/${encodeURIComponent(meetingId)}/status`,
    { status },
  );
}

// --- External session import (Claude Code / codex CLI transcripts) ---

/** 列出某个来源（claude / codex）本机可导入的外部会话。 */
export function listExternalSessions(
  config: RuntimeConfig,
  source: ExternalSessionSource,
): Promise<ExternalSessionSummary[]> {
  return request<{ sessions: ExternalSessionSummary[] }>(
    config,
    `/api/imports/external-sessions?source=${encodeURIComponent(source)}`,
  ).then((payload) => payload.sessions);
}

/** 预览导入：只取会话前 10 条消息，不落库。 */
export function previewExternalSession(
  config: RuntimeConfig,
  source: ExternalSessionSource,
  sessionId: string,
): Promise<ExternalSessionPreviewItem[]> {
  return postJson<{ meetingId: null; preview: ExternalSessionPreviewItem[] }>(
    config,
    '/api/meetings/import',
    { source, sessionId, previewOnly: true },
  ).then((payload) => payload.preview);
}

/**
 * 正式导入：把外部会话转写为 AgentMesa 会议时间线。
 * `adopt: true` 时同时把外部 session 种入 runner 的驱动句柄 sidecar，
 * 使后续深度驱动轮次 resume 原外部会话（快照导入与接管互相独立，
 * 接管失败不影响导入结果）。
 */
export function importExternalSession(
  config: RuntimeConfig,
  source: ExternalSessionSource,
  sessionId: string,
  adopt?: boolean,
): Promise<ImportSessionResult> {
  return postJson<ImportSessionResult>(config, '/api/meetings/import', {
    source,
    sessionId,
    ...(adopt === true ? { adopt: true } : {}),
  });
}

export function createTask(
  config: RuntimeConfig,
  input: {
    title: string;
    description?: string;
    assignedTo?: string;
    reviewer?: string;
    meetingId?: string;
  },
): Promise<MesaTask> {
  return postJson<MesaTask>(config, '/api/tasks', input);
}

export function updateTaskStatus(config: RuntimeConfig, taskId: string, status: string): Promise<MesaTask> {
  return postJson<MesaTask>(
    config,
    `/api/tasks/${encodeURIComponent(taskId)}/status`,
    { status },
  );
}

export function assignTask(config: RuntimeConfig, taskId: string, assignedTo: string): Promise<MesaTask> {
  return postJson<MesaTask>(
    config,
    `/api/tasks/${encodeURIComponent(taskId)}/assign`,
    { assignedTo },
  );
}
