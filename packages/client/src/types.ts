import type { EventEnvelope, MesaAgent, MesaAgentRun, MesaMessage, MesaMeeting, MesaRoom, MesaTask, MesaWorkspace, RoomMessage } from '@agentmesa/protocol';

export interface WorkflowState {
  workflowId: string;
  workflowDefinitionId: string;
  currentStep: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'waiting_approval';
  taskId: string;
  startedAt: string;
  completedAt?: string;
}

/** A driver permission request waiting for a human allow/deny (desk askHuman bridge). */
export interface PendingPermissionApproval {
  id: string;
  kind: 'tool' | 'command' | 'patch';
  title: string;
  resource?: string;
  reason?: string;
  requestedAt: string;
  meetingId?: string;
}

export interface RuntimeConfig {
  baseUrl: string;
  token?: string;
  view: 'widget' | 'main';
}

export interface DesktopBridge {
  toggleWidget(): Promise<void>;
  openMain(path?: string): Promise<void>;
  setWidgetExpanded(expanded: boolean): Promise<void>;
  hideWidget(): Promise<void>;
  minimizeMain(): Promise<void>;
  toggleMaximizeMain(): Promise<void>;
  closeMain(): Promise<void>;
}

export interface MesaSnapshot {
  runs: MesaAgentRun[];
  workflows: WorkflowState[];
  events: EventEnvelope[];
}

/** A meeting (session) together with its message timeline from the desk API. */
export type MeetingDetail = MesaMeeting & { messages: MesaMessage[] };

/** Registered workspaces + the active one, from GET /api/workspaces. */
export interface WorkspaceList {
  workspaces: MesaWorkspace[];
  activeWorkspaceId?: string;
}

/** A room together with its message timeline from the desk API. */
export type RoomDetail = MesaRoom & { messages: RoomMessage[]; totalMessages?: number };

/** Registered agents plus the tasks they are involved in, for session composition. */
export interface SessionComposition {
  meetings: MesaMeeting[];
  agents: MesaAgent[];
  tasks: MesaTask[];
}

// --- External session import (Claude Code / codex CLI transcripts) ---

/** 支持导入的外部会话来源。 */
export type ExternalSessionSource = 'claude' | 'codex';

/** GET /api/imports/external-sessions 返回的单条外部会话摘要。 */
export interface ExternalSessionSummary {
  source: ExternalSessionSource;
  sessionId: string;
  title: string;
  projectDir?: string;
  cwd?: string;
  /** ISO 时间戳。 */
  lastModified: string;
  sizeBytes: number;
  /** 5 分钟内仍活跃。 */
  active: boolean;
  threadSource?: string;
  /** 已导入过：指向持有该会话快照的会议。 */
  imported?: { meetingId: string };
  /** 源文件在快照之后又变化了——可刷新快照。 */
  hasUpdates?: boolean;
}

/** POST /api/meetings/import（previewOnly）返回的单条预览消息（≤10 条）。 */
export interface ExternalSessionPreviewItem {
  speaker: string;
  text: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** text / tool_use / tool_result / 其他。 */
  kind: string;
}

/** POST /api/meetings/import 正式导入的结果。 */
export interface ImportSessionResult {
  meetingId: string;
  messageCount: number;
  /** Phase 2 adopt：是否已把外部 session 种入 runner 的驱动句柄 sidecar。 */
  adopted: boolean;
  /** adopt 失败原因（快照导入本身仍成功）。 */
  adoptError?: string;
  /** 导入时刻 desk 的 AGENTMESA_SESSION_DRIVER 解析值（cli / auto / ...）。 */
  driverMode?: string;
  /** adopted=true 但 driverMode='cli' 时的提示：接管句柄不会生效。 */
  adoptWarning?: string;
}

declare global {
  interface Window {
    agentmesa?: DesktopBridge;
  }
}
