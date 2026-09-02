import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs';
import { execSync } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  addAgentToMeeting,
  addTaskToMeeting,
  appendMessage,
  createAgentRun,
  createMeeting,
  createRuntimeContext,
  createTask,
  getAgent,
  getAgentRun,
  getArtifact,
  getMeeting,
  getTask,
  listAgents,
  listAgentRuns,
  updateAgentRunStatus,
  listArtifacts,
  listCheckResults,
  listInboundHandoffs,
  listMeetings,
  listMessages,
  listOutboundHandoffs,
  listTasks,
  findClaudeSessionFile,
  findCodexSessionFile,
  importExternalSession,
  listClaudeSessions,
  listCodexSessions,
  listImportedExternalSessions,
  parseClaudeSession,
  parseCodexSession,
  refreshImportedMeeting,
  addWorkspace,
  getWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  readRegistry,
  createRoomStore,
  roomStoreDir,
  updateTaskStatus,
  assignTask,
  updateMeetingStatus,
  updateMeetingTrustLevel,
  removeAgentFromMeeting,
  registerAgent,
  MesaError,
  withLock,
} from '@agentmesa/core';
import type { MesaAgent, MesaWorkspace } from '@agentmesa/protocol';
import type { ExternalSessionSource, ExternalSessionSummary } from '@agentmesa/core';
import type { AgentRole, EventEnvelope, MeetingStatus, RoomMessage, RunStatus, TaskStatus, WorkflowDecisionCommand } from '@agentmesa/protocol';
import {
  CreateMeetingInputSchema,
  CreateMessageInputSchema,
  CreateTaskInputSchema,
  WorkflowDecisionCommandSchema,
} from '@agentmesa/protocol';
import type { MesaActor, MesaRuntimeContext } from '@agentmesa/core';
import { WorkflowEngine, decideWorkflow, listWorkflowStates } from '@agentmesa/orchestrator';
import {
  activateSessionAgent,
  adoptExternalDriverSession,
  terminateSessionChildren,
  loadDriverSessionHandle,
  resolveSessionDriverPreference,
  resolveSessionDriverRegistry,
  shouldUseSessionDriver,
  attachPermissionResponder,
  CodexAppServerDriver,
} from '@agentmesa/runner';
import {
  getSetupStatus,
  installMcpIntegration,
  uninstallMcpIntegration,
  setRunnerCommands,
  isIntegrationSide,
  type RunnerCommandPatch,
} from '@agentmesa/setup';
import { generateDashboardHtml } from './dashboard.js';
import { PermissionApprovalQueue, createDeskAskHuman } from './permission-approvals.js';

/** Most recent room messages returned by the room detail endpoint. */
const ROOM_MESSAGE_LIMIT = 200;

// --- Global room message watcher -------------------------------------------
// Room data lives in the global mesa home (outside any single workspace's event
// log), so the per-workspace SSE stream never carries room messages. To push
// new room messages in real time we watch the global `rooms/messages` directory
// (recursive) and fan out newly written message files to room SSE clients.
interface RoomMessageEvent {
  roomId: string;
  message: RoomMessage;
}
type RoomMessageListener = (payload: RoomMessageEvent) => void;

interface RoomWatcherState {
  watcher: FSWatcher | null;
  listeners: Set<RoomMessageListener>;
  sentMessageIds: Set<string>;
}

let roomWatcherState: RoomWatcherState | null = null;

/** Lazily start the single global room watcher; best-effort (clients poll as fallback). */
function ensureRoomWatcher(): RoomWatcherState {
  if (roomWatcherState) return roomWatcherState;
  const state: RoomWatcherState = { watcher: null, listeners: new Set(), sentMessageIds: new Set() };
  try {
    // Watch rooms/messages/<roomId>/<msgId>.json. The messages root must exist
    // BEFORE we watch it: Windows recursive watch does not reliably track files
    // written into subdirectories that are created after the watch starts, so
    // we create it up front and watch exactly that root.
    const messagesRoot = join(roomStoreDir(), 'messages');
    if (!existsSync(messagesRoot)) {
      mkdirSync(messagesRoot, { recursive: true });
    }
    const watcher = watch(messagesRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).split(/[\\/]/);
      const [roomId, msgFile] = rel;
      if (!roomId || !msgFile || !msgFile.endsWith('.json')) return;
      const msgId = msgFile.slice(0, -5);
      if (state.sentMessageIds.has(msgId)) return;
      // Reuse the store's parse/validate path; re-read on a later change event
      // if the file is not fully flushed yet (write is atomic, so rare).
      const message = createRoomStore().listMessages(roomId).find((entry) => entry.id === msgId);
      if (!message) return;
      state.sentMessageIds.add(msgId);
      if (state.sentMessageIds.size > 5000) state.sentMessageIds.clear(); // bound memory
      for (const listener of state.listeners) {
        try {
          listener({ roomId, message });
        } catch {
          // Listener errors never break the watcher.
        }
      }
    });
    watcher.unref();
    state.watcher = watcher;
  } catch (error) {
    // Watcher failure is non-fatal: room clients fall back to polling.
    console.error('Room message watcher failed to start:', error instanceof Error ? error.message : String(error));
  }
  roomWatcherState = state;
  return state;
}

export interface DeskServerOptions {
  host?: string;
  sessionToken?: string;
  writeActor?: MesaActor;
  /** Called after the active workspace changes (desktop uses it to restart the desk for the new root). */
  onActivateWorkspace?: (workspace: MesaWorkspace) => Promise<void> | void;
  /** Max time (ms) a session-collaboration CLI process may run before it is killed. */
  sessionRunTimeout?: number;
}

interface StoredCommandResult {
  commandId: string;
  fingerprint: string;
  status: 'pending' | 'completed';
  accepted: true;
  duplicate: boolean;
  result?: unknown;
}

/**
 * Resolve the actor identity under which a session agent's gated
 * (deep-driver) actions are judged: roles and client come from the agent's
 * registration record. Unregistered ids fall back to the write-back defaults
 * (see `writeBackSessionMessage` in runner/session-run.ts), mirroring how the
 * reply is attributed — though the driver path itself requires a registered
 * agent (see `activateMeetingAgent`).
 */
function sessionAgentActor(agentId: string, agent: MesaAgent | undefined): MesaActor {
  return {
    id: agentId,
    type: 'agent',
    roles: agent?.roles ?? ['builder'],
    client: agent?.client ?? 'claude-code',
  };
}

/**
 * Count running `codex.exe` processes (Windows only; undefined elsewhere or
 * when tasklist fails). Resident IDE app-servers and orphans alike compete
 * for `~/.codex` state — the count feeds the adoption-precheck warning.
 */
function countCodexProcesses(): number | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq codex.exe" /FO CSV /NH', {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return output.split('\n').filter((line) => line.includes('codex.exe')).length;
  } catch {
    return undefined;
  }
}

export class DeskServer {
  private readonly rootDir: string;
  private readonly requestedPort: number;
  private readonly host: string;
  private readonly sessionToken?: string;
  private readonly writeActor: MesaActor;
  private readonly onActivateWorkspace?: (workspace: MesaWorkspace) => Promise<void> | void;
  private readonly sessionRunTimeout?: number;
  private actualPort = 0;
  private server: Server | null = null;
  private readonly eventResponses = new Set<ServerResponse>();
  // Session grants (allow_session decisions) are observable through this
  // hook so a cache hit is distinguishable from a human clicking "allow".
  private readonly permissionApprovalQueue = new PermissionApprovalQueue({
    onGrantHit: (info) => {
      this.logQueueEvent?.('permission.session_grant_hit', info);
    },
  });
  /** Optional logger injected at start() when a runtime context exists. */
  private logQueueEvent: ((event: string, data: unknown) => void) | undefined;

  constructor(rootDir: string, port: number = 3456, options: DeskServerOptions = {}) {
    this.rootDir = rootDir;
    this.requestedPort = port;
    this.host = options.host ?? '127.0.0.1';
    this.sessionToken = options.sessionToken;
    this.writeActor = options.writeActor ?? {
      id: 'user:desk',
      type: 'user',
      roles: ['owner'],
      client: 'agentmesa-desk',
    };
    this.onActivateWorkspace = options.onActivateWorkspace;
    this.sessionRunTimeout = options.sessionRunTimeout;
  }

  async start(): Promise<void> {
    // A previous desk process may have crashed mid-run, leaving `running` runs
    // whose CLI children are gone. Reconcile them to `failed` so the UI does
    // not show them as "in progress" forever.
    this.reconcileInFlightRuns();

    const readContext = this.createReadContext();
    this.logQueueEvent = (event, data) => readContext.logger.info(event, data as Record<string, unknown>);

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res, readContext).catch((error) => {
          this.handleError(res, error);
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.requestedPort, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.actualPort = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Kill any in-flight session-collaboration CLI processes first so they do
    // not linger as orphans after the host stops or switches workspace.
    terminateSessionChildren();
    // Fail-closed any permission approvals still awaiting a human answer —
    // the desk restart (also the workspace-switch path) cannot serve them.
    this.permissionApprovalQueue.clear();

    for (const response of this.eventResponses) {
      response.end();
    }
    this.eventResponses.clear();

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  getPort(): number {
    return this.actualPort || this.requestedPort;
  }

  /**
   * Pending driver-permission approvals (deep-driver `askHuman` gate). The
   * main-session wiring injects `createDeskAskHuman(this.permissionApprovals,
   * { meetingId })` into `attachPermissionResponder`; the HTTP surface under
   * `/api/permissions/*` lets the desktop UI list and decide them.
   */
  get permissionApprovals(): PermissionApprovalQueue {
    return this.permissionApprovalQueue;
  }

  private createReadContext(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: this.rootDir,
      actor: {
        id: 'system:desk',
        type: 'system',
        roles: ['read_only'],
      },
    });
  }

  private createWriteContext(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: this.rootDir,
      actor: this.writeActor,
    });
  }

  /**
   * Startup reconciliation: runs left in `running` by a previous desk process
   * can never finish (their CLI children are gone), so mark them `failed`.
   * `running → failed` is a valid transition (agent-run-service.ts).
   */
  private reconcileInFlightRuns(): void {
    const ctx = this.createWriteContext();
    for (const run of listAgentRuns(ctx).filter((r) => r.status === 'running')) {
      try {
        updateAgentRunStatus(ctx, run.id, 'failed', {
          error: 'Desk restarted while this run was in flight; execution was interrupted.',
        });
        ctx.logger.warn('Reconciled in-flight run to failed after desk restart', {
          runId: run.id,
          agentId: run.agentId,
        });
      } catch (error) {
        ctx.logger.warn('Failed to reconcile in-flight run', {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Invite-and-activate: spawn a real CLI agent (claude -p / codex exec) to
   * join the meeting. Creates a `session` run carrying the meeting context and
   * executes it in the background; the agent's reply is written back into the
   * session timeline. Called fire-and-forget from the invite endpoint.
   */
  private async activateMeetingAgent(
    meetingId: string,
    agentId: string,
    writeContext: MesaRuntimeContext,
  ): Promise<void> {
    // Session runs carry their own deep-driver switch (`AGENTMESA_SESSION_DRIVER`,
    // default 'cli') so the task-run switch (`AGENTMESA_DRIVER`) never silently
    // changes the meeting-speech transport. Unregistered agent ids stay on the
    // plain CLI path.
    const preference = resolveSessionDriverPreference();
    let agent: MesaAgent | undefined;
    try {
      agent = getAgent(writeContext, agentId);
    } catch {
      agent = undefined;
    }
    const baseOptions = { timeout: this.sessionRunTimeout };
    // Trust posture: `approval` (default) keeps the speech guard; `trusted`
    // is the human's explicit decision to let writes be judged by role
    // capabilities instead of per-action approval cards. Blocked patterns
    // and secret-path checks apply at BOTH levels (they run before the
    // fence inside the permission bridge).
    let trustLevel: 'approval' | 'trusted' = 'approval';
    try {
      trustLevel = getMeeting(writeContext, meetingId).trustLevel;
    } catch {
      // Meeting removed between invite and activation — keep the safe default.
    }
    const options = agent && shouldUseSessionDriver(preference, agent.client)
      ? attachPermissionResponder({
          ...baseOptions,
          // Session-run registry follows AGENTMESA_SESSION_DRIVER alone — the
          // task-run switch (AGENTMESA_DRIVER) must not silently empty it.
          driverRegistry: resolveSessionDriverRegistry(),
          driverPreference: preference,
          // Takeover semantics: when this agent+meeting has an adopted
          // external handle, resume must fail loud. A broken handle silently
          // cold-starting a new conversation would defeat the takeover (the
          // meeting timeline would keep going while talking to a stranger).
          ...(loadDriverSessionHandle(writeContext, agentId, meetingId)?.adopted === true
            ? { resumeMode: 'strict' as const }
            : {}),
        }, {
          ctx: writeContext,
          // Gated actions run under the agent's registered identity, not the
          // desk write actor.
          actor: sessionAgentActor(agentId, agent),
          // Speech guard (approval level, the default): meeting-speech turns
          // are read-only — read-only commands pass, while gated actions
          // (patches, mutating tools, non-read-only commands) escalate to the
          // human approval gate below instead of being silently denied. At
          // the `trusted` level the fence is off: writes go through the role
          // capability / file-access judgment directly. requirePermissions
          // stays true at BOTH levels — the codex read-only sandbox + the
          // claude permissionMode keep every gated action flowing through
          // the bridge so trusted writes are still judged and audited.
          speechGuard: trustLevel !== 'trusted',
          // Human approval bridge: gated speech actions arrive here as desk
          // approval cards (5-minute auto-deny fail-closed window).
          askHuman: createDeskAskHuman(this.permissionApprovals, { meetingId }),
        })
      : baseOptions;
    await activateSessionAgent(writeContext, meetingId, agentId, options);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    readContext: MesaRuntimeContext,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:${this.getPort()}`}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/') && this.sessionToken && !this.isAuthorized(req, url)) {
      this.sendError(res, 401, 'Unauthorized');
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      await this.handleWriteRequest(req, res, pathname);
      return;
    }
    if (req.method !== 'GET') {
      this.sendError(res, 405, 'Method not allowed');
      return;
    }

    if (pathname === '/') {
      this.sendHtml(res, generateDashboardHtml());
      return;
    }

    if (pathname === '/api/events') {
      this.sendJson(res, this.listEventEnvelopes(readContext, url.searchParams.get('cursor') ?? undefined, this.parseLimit(url)));
      return;
    }
    if (pathname === '/api/events/stream') {
      this.streamEvents(req, res, readContext, url.searchParams.get('cursor') ?? req.headers['last-event-id'] as string | undefined);
      return;
    }
    if (pathname === '/api/rooms/events/stream') {
      this.streamRoomEvents(req, res);
      return;
    }
    if (pathname === '/api/tasks') {
      this.sendJson(res, listTasks(readContext));
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      this.sendJson(res, getTask(readContext, taskMatch[1]!));
      return;
    }
    if (pathname === '/api/meetings') {
      this.sendJson(res, listMeetings(readContext));
      return;
    }

    const meetingMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
    if (meetingMatch) {
      const meeting = getMeeting(readContext, meetingMatch[1]!);
      // Include meeting-level messages (sent directly to the meeting with no
      // taskId) in addition to per-task ones — agents often post status updates
      // straight to the meeting, and those were previously invisible.
      const messages = listMessages(readContext).filter((message) =>
        message.meetingId === meeting.id || meeting.tasks.some((taskId) => message.taskId === taskId),
      );
      this.sendJson(res, { ...meeting, messages });
      return;
    }
    if (pathname === '/api/artifacts') {
      this.sendJson(res, listArtifacts(readContext));
      return;
    }

    const artifactMatch = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      this.sendJson(res, getArtifact(readContext, artifactMatch[1]!));
      return;
    }
    if (pathname === '/api/agents') {
      this.sendJson(res, listAgents(readContext));
      return;
    }
    if (pathname === '/api/runs') {
      this.sendJson(res, listAgentRuns(readContext));
      return;
    }
    if (pathname === '/api/workflows') {
      this.sendJson(res, listWorkflowStates(readContext));
      return;
    }
    if (pathname === '/api/handoffs') {
      this.sendJson(res, {
        outbound: listOutboundHandoffs(readContext),
        inbound: listInboundHandoffs(readContext),
      });
      return;
    }
    if (pathname === '/api/checks') {
      this.sendJson(res, listCheckResults(readContext));
      return;
    }
    if (pathname === '/api/permissions/pending') {
      this.sendJson(res, { pending: this.permissionApprovalQueue.list() });
      return;
    }
    if (pathname === '/api/imports/external-sessions') {
      const source = url.searchParams.get('source');
      if (source !== 'claude' && source !== 'codex') {
        this.sendError(res, 400, 'source must be "claude" or "codex"');
        return;
      }
      // codex only: also surface subagent / guardian_review threads. Claude
      // transcripts carry no thread source, so the flag is a no-op there.
      const includeSubagents = url.searchParams.get('includeSubagents') === 'true';
      this.sendJson(res, {
        sessions: this.listExternalSessionsWithImportState(source, readContext, includeSubagents),
      });
      return;
    }
    if (pathname === '/api/setup/status') {
      this.sendJson(res, getSetupStatus(this.rootDir));
      return;
    }
    if (pathname === '/api/status') {
      this.sendJson(res, {
        tasks: listTasks(readContext).length,
        meetings: listMeetings(readContext).length,
        agents: listAgents(readContext).length,
        artifacts: listArtifacts(readContext).length,
        runs: listAgentRuns(readContext).length,
        checks: listCheckResults(readContext).length,
        handoffs: listOutboundHandoffs(readContext).length + listInboundHandoffs(readContext).length,
      });
      return;
    }
    if (pathname === '/api/workspaces') {
      const registry = readRegistry();
      this.sendJson(res, {
        workspaces: registry.workspaces,
        activeWorkspaceId: registry.activeWorkspaceId,
      });
      return;
    }

    if (pathname === '/api/rooms') {
      // Enrich each room with its latest message so the list can show a preview
      // and the client can compute unread state without opening every room.
      const store = createRoomStore();
      const rooms = store.listRooms().map((room) => {
        const last = store.listMessages(room.id).at(-1);
        return {
          ...room,
          lastMessageId: last?.id,
          lastMessageAt: last?.createdAt,
          lastMessagePreview: last?.summary,
        };
      });
      this.sendJson(res, rooms);
      return;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch) {
      const roomId = roomMatch[1]!;
      const store = createRoomStore();
      // Cap the timeline to the most recent 200 messages so long-lived rooms
      // don't load unbounded history; `totalMessages` keeps the count visible.
      const allMessages = store.listMessages(roomId);
      this.sendJson(res, {
        ...store.getRoom(roomId),
        messages: allMessages.slice(-ROOM_MESSAGE_LIMIT),
        totalMessages: allMessages.length,
      });
      return;
    }

    const workspaceReadMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/(meetings|agents)$/);
    if (workspaceReadMatch) {
      const workspace = getWorkspace(workspaceReadMatch[1]!);
      if (!workspace) {
        this.sendError(res, 404, `Unknown workspace: ${workspaceReadMatch[1]}`);
        return;
      }
      const targetCtx = createRuntimeContext({
        rootDir: workspace.rootDir,
        actor: { id: 'system:desk', type: 'system', roles: ['read_only'] },
      });
      const data = workspaceReadMatch[2] === 'meetings' ? listMeetings(targetCtx) : listAgents(targetCtx);
      this.sendJson(res, data);
      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  /**
   * Optional scan-root override for the external-session import surface.
   * Unset (the normal desktop case) → scanner defaults under the user's home.
   */
  private importRootDir(source: ExternalSessionSource): string | undefined {
    const raw = source === 'claude'
      ? process.env.AGENTMESA_IMPORT_CLAUDE_ROOT
      : process.env.AGENTMESA_IMPORT_CODEX_ROOT;
    return raw && raw.trim().length > 0 ? raw : undefined;
  }

  /**
   * Precheck an external session for adoption (adopt=true) BEFORE importing:
   * codex runs a live `thread/resume` probe (spawn app-server → handshake →
   * resume → close) plus a stray-process census; claude probes the local
   * transcript (the same check `adoptExternalDriverSession` applies at import
   * time). Read-only — the caller surfaces the verdict inline so a takeover
   * that cannot hold is visible before the user commits to it.
   */
  private async precheckExternalAdoption(
    source: ExternalSessionSource,
    sessionId: string,
  ): Promise<{
    source: ExternalSessionSource;
    sessionId: string;
    adoptable: boolean;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
    warnings: string[];
  }> {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    const warnings: string[] = [];

    if (source === 'claude') {
      // undefined rootDir falls back to the scanner default (~/.claude/projects)
      // — same behavior as the import endpoint; without this the precheck would
      // report "transcript not found" whenever the env override is unset.
      const rootDir = this.importRootDir(source);
      const filePath = findClaudeSessionFile(sessionId, rootDir);
      checks.push(
        filePath
          ? { name: 'transcript', ok: true, detail: filePath }
          : { name: 'transcript', ok: false, detail: '未找到本地转录文件（resume 依赖 ~/.claude/projects 下的 JSONL）' },
      );
      return { source, sessionId, adoptable: checks.every((check) => check.ok), checks, warnings };
    }

    // codex: stray-process census first — the probe spawns its own app-server.
    const stray = countCodexProcesses();
    if (stray !== undefined && stray > 0) {
      warnings.push(
        `检测到 ${stray} 个运行中的 codex.exe 进程——流浪 app-server 会竞争 ~/.codex 状态，可能导致 resume 挂死或失败`,
      );
    }

    const driver = new CodexAppServerDriver({ requestTimeoutMs: 30_000 });
    let available = false;
    try {
      available = await driver.isAvailable();
    } catch {
      available = false;
    }
    checks.push(
      available
        ? { name: 'command', ok: true, detail: 'codex app-server 可用' }
        : { name: 'command', ok: false, detail: 'codex app-server 命令不可用（检查 PATH 或 AGENTMESA_CODEX_APP_SERVER_CMD）' },
    );
    if (!available) {
      return { source, sessionId, adoptable: false, checks, warnings };
    }

    try {
      await driver.probeResume(sessionId, this.rootDir);
      checks.push({ name: 'resume', ok: true, detail: 'thread/resume 探测成功' });
    } catch (error) {
      checks.push({
        name: 'resume',
        ok: false,
        detail: `thread/resume 探测失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return { source, sessionId, adoptable: checks.every((check) => check.ok), checks, warnings };
  }

  /** List external sessions defensively: a missing/unreadable root lists empty. */
  private listExternalSessions(
    source: ExternalSessionSource,
    includeSubagents = false,
  ): ExternalSessionSummary[] {
    const rootDir = this.importRootDir(source);
    const options = rootDir === undefined ? undefined : { rootDir, includeSubagents };
    try {
      return source === 'claude'
        ? listClaudeSessions(options)
        : listCodexSessions(options);
    } catch (error) {
      console.error('Failed to list external sessions:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Session list annotated with import state: `imported` carries the meeting
   * that holds this session's snapshot, and `hasUpdates` is true when the
   * source file changed since the snapshot was taken (mtime or size differs
   * from the recorded anchors) — the signal for the refresh affordance.
   */
  private listExternalSessionsWithImportState(
    source: ExternalSessionSource,
    readContext: MesaRuntimeContext,
    includeSubagents = false,
  ): Array<ExternalSessionSummary & {
    imported?: { meetingId: string };
    hasUpdates?: boolean;
  }> {
    const sessions = this.listExternalSessions(source, includeSubagents);
    let importedIndex: Map<string, { meetingId: string; sourceLastModified?: string; sourceSizeBytes?: number }>;
    try {
      importedIndex = new Map(
        listImportedExternalSessions(readContext)
          .filter((entry) => entry.source === source)
          .map((entry) => [entry.externalSessionId, entry]),
      );
    } catch {
      importedIndex = new Map();
    }
    return sessions.map((session) => {
      const imported = importedIndex.get(session.sessionId);
      if (!imported) {
        return session;
      }
      const anchorsChanged = imported.sourceLastModified !== undefined
        && (imported.sourceLastModified !== session.lastModified
          || imported.sourceSizeBytes !== session.sizeBytes);
      return {
        ...session,
        imported: { meetingId: imported.meetingId },
        ...(anchorsChanged ? { hasUpdates: true } : {}),
      };
    });
  }

  private async handleWriteRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (!this.sessionToken) {
      this.sendError(res, 403, 'Write API requires a configured session token');
      return;
    }

    const writeContext = this.createWriteContext();
    if (pathname === '/api/agents') {
      const body = await this.readJsonBody(req) as {
        id?: unknown;
        name?: unknown;
        client?: unknown;
        roles?: unknown;
        clientId?: unknown;
        workspaceId?: unknown;
      };
      if (
        typeof body.id !== 'string' || body.id.trim().length === 0
        || typeof body.name !== 'string' || body.name.trim().length === 0
        || typeof body.client !== 'string' || body.client.trim().length === 0
        || !Array.isArray(body.roles) || body.roles.length === 0
      ) {
        throw new MesaError('VALIDATION_ERROR', 'id, name, client, and roles (non-empty) are required');
      }
      const agent = registerAgent(writeContext, {
        id: body.id,
        name: body.name,
        client: body.client,
        status: 'available',
        roles: body.roles as AgentRole[],
        ...(typeof body.clientId === 'string' && body.clientId.trim() ? { clientId: body.clientId } : {}),
        ...(typeof body.workspaceId === 'string' && body.workspaceId.trim() ? { workspaceId: body.workspaceId } : {}),
      });
      this.sendJson(res, agent, 201);
      return;
    }

    if (pathname === '/api/workspaces') {
      const body = await this.readJsonBody(req) as { rootDir?: unknown; name?: unknown };
      if (typeof body.rootDir !== 'string' || body.rootDir.trim().length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'rootDir is required');
      }
      const workspace = addWorkspace({
        rootDir: body.rootDir,
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name } : {}),
      });
      this.sendJson(res, workspace, 201);
      return;
    }

    const workspaceActivateMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/activate$/);
    if (workspaceActivateMatch) {
      const workspace = setActiveWorkspace(workspaceActivateMatch[1]!);
      // Fire the supervisor hook off the request's await chain. The desktop
      // supervisor restarts the desk for the new root (stopping this server),
      // and `server.close()` waits for in-flight request connections — awaiting
      // the restart here would deadlock: the restart waits for this request,
      // this request waits for the restart.
      if (this.onActivateWorkspace) {
        const hook = this.onActivateWorkspace;
        const restart = setImmediate(() => {
          Promise.resolve(hook(workspace)).catch((error) => {
            console.error('Failed to restart desk for workspace:', error);
          });
        });
        restart.unref?.();
      }
      this.sendJson(res, { ...workspace, switched: true });
      return;
    }

    const workspaceDeleteMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (workspaceDeleteMatch && !pathname.includes('/activate')) {
      removeWorkspace(workspaceDeleteMatch[1]!);
      this.sendJson(res, { ok: true });
      return;
    }

    // --- Room endpoints (global, cross-workspace) ---

    if (pathname === '/api/rooms') {
      const body = await this.readJsonBody(req) as { name?: unknown; purpose?: unknown };
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'name is required');
      }
      const room = createRoomStore().createRoom({
        name: body.name,
        ...(typeof body.purpose === 'string' && body.purpose.trim() ? { purpose: body.purpose } : {}),
      });
      this.sendJson(res, room, 201);
      return;
    }

    const roomMemberMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/members$/);
    if (roomMemberMatch) {
      const body = await this.readJsonBody(req) as {
        workspaceId?: unknown;
        kind?: unknown;
        ref?: unknown;
        label?: unknown;
      };
      if (
        typeof body.workspaceId !== 'string' ||
        typeof body.kind !== 'string' ||
        typeof body.ref !== 'string'
      ) {
        throw new MesaError('VALIDATION_ERROR', 'workspaceId, kind, and ref are required');
      }
      if (body.kind !== 'session' && body.kind !== 'agent' && body.kind !== 'human') {
        throw new MesaError('VALIDATION_ERROR', 'kind must be "session", "agent", or "human"');
      }
      const room = createRoomStore().invite(roomMemberMatch[1]!, {
        workspaceId: body.workspaceId,
        kind: body.kind,
        ref: body.ref,
        ...(typeof body.label === 'string' ? { label: body.label } : {}),
      });
      this.sendJson(res, room);
      return;
    }

    const roomLeaveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
    if (roomLeaveMatch) {
      const body = await this.readJsonBody(req) as {
        workspaceId?: unknown;
        kind?: unknown;
        ref?: unknown;
      };
      if (
        typeof body.workspaceId !== 'string' ||
        typeof body.kind !== 'string' ||
        typeof body.ref !== 'string'
      ) {
        throw new MesaError('VALIDATION_ERROR', 'workspaceId, kind, and ref are required');
      }
      if (body.kind !== 'session' && body.kind !== 'agent' && body.kind !== 'human') {
        throw new MesaError('VALIDATION_ERROR', 'kind must be "session", "agent", or "human"');
      }
      const room = createRoomStore().leave(roomLeaveMatch[1]!, {
        workspaceId: body.workspaceId,
        kind: body.kind,
        ref: body.ref,
      });
      this.sendJson(res, room);
      return;
    }

    const roomMessageMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
    if (roomMessageMatch) {
      const body = await this.readJsonBody(req) as {
        workspaceId?: unknown;
        from?: unknown;
        summary?: unknown;
        type?: unknown;
        mentions?: unknown;
        senderRole?: unknown;
        origin?: unknown;
      };
      const store = createRoomStore();
      const message = store.sendMessage(roomMessageMatch[1]!, {
        workspaceId: body.workspaceId,
        from: body.from,
        summary: body.summary,
        ...(typeof body.type === 'string' ? { type: body.type } : {}),
        // M2 协作语义字段透传（core 的 SendRoomMessageInputSchema 已支持）。
        ...(Array.isArray(body.mentions) && body.mentions.every((m) => typeof m === 'string')
          ? { mentions: body.mentions as string[] }
          : {}),
        ...(typeof body.senderRole === 'string' ? { senderRole: body.senderRole } : {}),
        ...(body.origin === 'human' || body.origin === 'agent' ? { origin: body.origin } : {}),
      });
      this.sendJson(res, message, 201);
      return;
    }

    const roomDeleteMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomDeleteMatch) {
      createRoomStore().deleteRoom(roomDeleteMatch[1]!);
      this.sendJson(res, { ok: true });
      return;
    }

    const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
    if (taskStatusMatch) {
      const body = await this.readJsonBody(req) as { status?: unknown; updatedBy?: unknown };
      if (typeof body.status !== 'string' || body.status.length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'status is required');
      }
      const task = updateTaskStatus(writeContext, taskStatusMatch[1]!, body.status as TaskStatus);
      this.sendJson(res, task);
      return;
    }

    const runStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)\/status$/);
    if (runStatusMatch) {
      const body = await this.readJsonBody(req) as { status?: unknown; output?: unknown; error?: unknown };
      if (typeof body.status !== 'string' || body.status.length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'status is required');
      }
      const run = updateAgentRunStatus(writeContext, runStatusMatch[1]!, body.status as RunStatus, {
        ...(typeof body.output === 'string' ? { output: body.output } : {}),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
      });
      this.sendJson(res, run);
      return;
    }

    const permissionDecideMatch = pathname.match(/^\/api\/permissions\/([^/]+)\/decide$/);
    if (permissionDecideMatch) {
      const body = await this.readJsonBody(req) as { decision?: unknown };
      if (
        body.decision !== 'allow'
        && body.decision !== 'deny'
        && body.decision !== 'allow_session'
      ) {
        throw new MesaError('VALIDATION_ERROR', 'decision must be "allow", "deny" or "allow_session"');
      }
      // The client URL-encodes the request id (`encodeURIComponent`) and
      // permission ids routinely contain `:` / `/` (e.g. "Write:call_42bd…"),
      // so decode before queue lookup — otherwise every decide call 404s.
      const requestId = decodeURIComponent(permissionDecideMatch[1]!);
      const decided = this.permissionApprovalQueue.decide(requestId, body.decision);
      if (!decided) {
        this.sendError(res, 404, `Unknown permission request: ${requestId}`);
        return;
      }
      this.sendJson(res, { ok: true });
      return;
    }

    const taskAssignMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/assign$/);
    if (taskAssignMatch) {
      const body = await this.readJsonBody(req) as { assignedTo?: unknown };
      if (typeof body.assignedTo !== 'string' || body.assignedTo.length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'assignedTo is required');
      }
      const task = assignTask(writeContext, taskAssignMatch[1]!, body.assignedTo);
      this.sendJson(res, task);
      return;
    }

    if (pathname === '/api/messages') {
      const input = CreateMessageInputSchema.omit({ from: true }).parse(await this.readJsonBody(req));
      this.sendJson(res, appendMessage(writeContext, input), 201);
      return;
    }

    if (pathname === '/api/meetings') {
      const input = CreateMeetingInputSchema.parse(await this.readJsonBody(req));
      this.sendJson(res, createMeeting(writeContext, input), 201);
      return;
    }

    // Adoption precheck: probe whether adopt=true would actually hold BEFORE
    // importing (codex: live thread/resume probe + stray-process census;
    // claude: local transcript probe). Read-only — nothing is persisted.
    if (pathname === '/api/imports/precheck') {
      const body = await this.readJsonBody(req) as { source?: unknown; sessionId?: unknown };
      if (body.source !== 'claude' && body.source !== 'codex') {
        throw new MesaError('VALIDATION_ERROR', 'source must be "claude" or "codex"');
      }
      if (typeof body.sessionId !== 'string' || body.sessionId.trim().length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'sessionId is required');
      }
      this.sendJson(res, await this.precheckExternalAdoption(body.source, body.sessionId));
      return;
    }

    if (pathname === '/api/meetings/import') {
      const body = await this.readJsonBody(req) as {
        source?: unknown;
        sessionId?: unknown;
        previewOnly?: unknown;
        adopt?: unknown;
        groupName?: unknown;
      };
      if (body.source !== 'claude' && body.source !== 'codex') {
        throw new MesaError('VALIDATION_ERROR', 'source must be "claude" or "codex"');
      }
      if (typeof body.sessionId !== 'string' || body.sessionId.trim().length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'sessionId is required');
      }
      const source: ExternalSessionSource = body.source;
      const rootDir = this.importRootDir(source);
      const filePath = source === 'claude'
        ? findClaudeSessionFile(body.sessionId, rootDir)
        : findCodexSessionFile(body.sessionId, rootDir);
      if (!filePath) {
        this.sendError(res, 404, `EXTERNAL_SESSION_NOT_FOUND: ${source} session ${body.sessionId}`);
        return;
      }
      const parsed = source === 'claude'
        ? parseClaudeSession(filePath)
        : parseCodexSession(filePath);
      if (body.previewOnly === true) {
        this.sendJson(res, {
          meetingId: null,
          preview: parsed.messages.slice(0, 10).map((message) => ({
            speaker: message.speaker,
            text: message.body ?? message.summary,
            createdAt: message.createdAt,
            kind: message.kind,
          })),
        });
        return;
      }
      const result = importExternalSession(writeContext, {
        source,
        sessionId: body.sessionId,
        parsed,
        ...(typeof body.groupName === 'string' && body.groupName.trim().length > 0
          ? { groupName: body.groupName.trim() }
          : {}),
      });

      // Phase 2 adopt: optionally seed the runner's driver-handle sidecar so
      // later deep-driver turns for this agent+meeting RESUME the original
      // external session instead of cold-starting. Adoption never activates
      // the agent or starts a run here — the next invited speaking turn picks
      // the handle up naturally. A failed adoption must not fail the import:
      // the snapshot (meeting) is already durable at this point.
      let adopted = false;
      let adoptError: string | undefined;
      if (body.adopt === true) {
        try {
          adoptExternalDriverSession(writeContext, {
            agentId: source === 'claude' ? 'agent:claude-external' : 'agent:codex-external',
            scope: result.meetingId,
            kind: source === 'claude' ? 'claude-agent-sdk' : 'codex-app-server',
            backendSessionId: body.sessionId,
            // Same scan root the import used (AGENTMESA_IMPORT_CLAUDE_ROOT);
            // codex sessions have no local transcript to probe.
            claudeProjectsRoot: source === 'claude' ? rootDir : undefined,
          });
          adopted = true;
        } catch (error) {
          adopted = false;
          adoptError = error instanceof Error ? error.message : String(error);
        }
      }
      const driverMode = resolveSessionDriverPreference();
      this.sendJson(res, {
        ...result,
        adopted,
        ...(adoptError !== undefined ? { adoptError } : {}),
        driverMode,
        ...(adopted && driverMode === 'cli'
          ? {
            adoptWarning:
              '已种入接管句柄，但当前 AGENTMESA_SESSION_DRIVER=cli，会话协作仍走 CLI 单发模式，不会 resume 外部会话；需将其设为 claude-agent-sdk / codex-app-server / auto 后接管才生效',
          }
          : {}),
      }, 201);
      return;
    }

    // Snapshot refresh: re-parse the recorded source transcript and replace
    // the imported snapshot (user-authored meeting messages are preserved).
    const meetingRefreshMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/refresh$/);
    if (meetingRefreshMatch) {
      const result = refreshImportedMeeting(writeContext, decodeURIComponent(meetingRefreshMatch[1]!));
      this.sendJson(res, result);
      return;
    }

    const meetingAgentMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/agents$/);
    if (meetingAgentMatch) {
      const body = await this.readJsonBody(req) as { agentId?: unknown };
      if (typeof body.agentId !== 'string' || body.agentId.length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'agentId is required');
      }
      const meetingId = meetingAgentMatch[1]!;
      const meeting = addAgentToMeeting(writeContext, meetingId, body.agentId);
      // 邀请即激活：立即返回 200，后台 fire-and-forget spawn 真实 CLI agent。
      // 绝不 await —— 否则邀请请求会阻塞到 CLI 进程结束（最长 300s）。
      void this.activateMeetingAgent(meetingId, body.agentId, writeContext).catch((error) => {
        writeContext.logger.error('Failed to activate meeting agent', {
          meetingId,
          agentId: body.agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      this.sendJson(res, meeting);
      return;
    }

    const meetingStatusMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/status$/);
    if (meetingStatusMatch) {
      const body = await this.readJsonBody(req) as { status?: unknown };
      if (typeof body.status !== 'string' || body.status.length === 0) {
        throw new MesaError('VALIDATION_ERROR', 'status is required');
      }
      const meeting = updateMeetingStatus(
        writeContext,
        meetingStatusMatch[1]!,
        body.status as MeetingStatus,
      );
      this.sendJson(res, meeting);
      return;
    }

    const meetingTrustMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/trust-level$/);
    if (meetingTrustMatch) {
      const body = await this.readJsonBody(req) as { trustLevel?: unknown };
      if (body.trustLevel !== 'approval' && body.trustLevel !== 'trusted') {
        throw new MesaError('VALIDATION_ERROR', 'trustLevel must be "approval" or "trusted"');
      }
      const meeting = updateMeetingTrustLevel(writeContext, meetingTrustMatch[1]!, body.trustLevel);
      this.sendJson(res, meeting);
      return;
    }

    const meetingAgentRemoveMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/agents\/([^/]+)$/);
    if (meetingAgentRemoveMatch) {
      const meeting = removeAgentFromMeeting(writeContext, meetingAgentRemoveMatch[1]!, meetingAgentRemoveMatch[2]!);
      this.sendJson(res, meeting);
      return;
    }

    if (pathname === '/api/tasks') {
      const input = CreateTaskInputSchema.omit({ createdBy: true }).parse(await this.readJsonBody(req));
      const task = createTask(writeContext, input);
      // Link the task into its meeting so the session surface can list it.
      if (task.meetingId) {
        addTaskToMeeting(writeContext, task.meetingId, task.id);
      }
      this.sendJson(res, task, 201);
      return;
    }

    const decisionMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/decision$/);
    if (decisionMatch) {
      const command = WorkflowDecisionCommandSchema.parse(await this.readJsonBody(req));
      const workflowId = decisionMatch[1]!;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({
          workflowId,
          decision: command.decision,
          reason: command.reason,
          message: command.message,
        }))
        .digest('hex');
      const result = await this.executeIdempotentCommand(writeContext, command.commandId, fingerprint, () => {
        const state = decideWorkflow(writeContext, workflowId, command);
        if (state.status === 'running') {
          const continuation = setImmediate(() => {
            new WorkflowEngine(writeContext).advanceWorkflow(state).catch((error) => {
              writeContext.logger.error('Failed to resume approved workflow', {
                workflowId: state.workflowId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          });
          continuation.unref();
        }
        return state;
      });
      this.sendJson(res, result, 202);
      return;
    }

    if (pathname === '/api/setup/install' || pathname === '/api/setup/uninstall') {
      const body = await this.readJsonBody(req) as { side?: unknown };
      if (typeof body.side !== 'string' || !isIntegrationSide(body.side)) {
        throw new MesaError('VALIDATION_ERROR', 'side must be "claude" or "codex"');
      }
      const result = pathname === '/api/setup/install'
        ? installMcpIntegration(body.side, undefined, this.rootDir)
        : uninstallMcpIntegration(body.side);
      this.sendJson(res, result, result.ok ? 200 : 502);
      return;
    }

    if (pathname === '/api/setup/runners') {
      const body = await this.readJsonBody(req) as { claudeCmd?: unknown; codexCmd?: unknown };
      const patch: RunnerCommandPatch = {};
      for (const key of ['claudeCmd', 'codexCmd'] as const) {
        const value = body[key];
        if (value === null) {
          patch[key] = null;
        } else if (typeof value === 'string') {
          patch[key] = value;
        } else if (value !== undefined) {
          throw new MesaError('VALIDATION_ERROR', `${key} must be a string or null`);
        }
      }
      this.sendJson(res, setRunnerCommands(this.rootDir, patch));
      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  private listEventEnvelopes(
    context: MesaRuntimeContext,
    cursor?: string,
    limit: number = 100,
  ): EventEnvelope[] {
    if (context.eventStore.listAfter) {
      return context.eventStore.listAfter(cursor, limit);
    }
    const events = context.eventStore.list();
    const index = cursor ? events.findIndex((event) => event.id === cursor) : -1;
    if (cursor && index === -1) {
      throw new MesaError('VALIDATION_ERROR', `Unknown event cursor: ${cursor}`);
    }
    return events.slice(index + 1, index + 1 + limit).map((event) => ({ cursor: event.id, event }));
  }

  private streamEvents(
    req: IncomingMessage,
    res: ServerResponse,
    context: MesaRuntimeContext,
    cursor?: string,
  ): void {
    const livePending = new Map<string, EventEnvelope>();
    let replaying = true;
    let closed = false;
    let pendingWrites = 0;
    let writeChain = Promise.resolve();
    let unsubscribe: () => void = () => undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      livePending.clear();
      this.eventResponses.delete(res);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);

    const writeEnvelope = async (envelope: EventEnvelope) => {
      if (closed) return;
      const writable = res.write(
        `id: ${envelope.cursor}\nevent: mesa-event\ndata: ${JSON.stringify(envelope)}\n\n`,
      );
      if (!writable) {
        await once(res, 'drain');
      }
    };

    const enqueue = (envelope: EventEnvelope) => {
      if (closed || livePending.has(envelope.cursor)) return;
      if (replaying) {
        if (livePending.size >= 2000) {
          res.destroy(new Error('SSE client is too slow'));
          cleanup();
          return;
        }
        livePending.set(envelope.cursor, envelope);
        return;
      }
      if (pendingWrites >= 2000) {
        res.destroy(new Error('SSE client is too slow'));
        cleanup();
        return;
      }
      pendingWrites += 1;
      writeChain = writeChain
        .then(() => writeEnvelope(envelope))
        .catch(() => {
          cleanup();
        })
        .finally(() => {
          pendingWrites -= 1;
        });
    };

    const start = async () => {
      unsubscribe = context.eventStore.subscribe?.(enqueue) ?? (() => undefined);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      this.eventResponses.add(res);

      let replayCursor = cursor;
      let page: EventEnvelope[] = [];
      while (!closed) {
        try {
          page = this.listEventEnvelopes(context, replayCursor, 500);
        } catch (error) {
          // A cursor persisted by an older client can outlive the event log
          // (workspace reset, log rotation). Replay from the start instead of
          // killing the stream, which would loop the client forever.
          if (replayCursor && error instanceof MesaError && error.code === 'VALIDATION_ERROR') {
            replayCursor = undefined;
            continue;
          }
          throw error;
        }
        for (const envelope of page) {
          livePending.delete(envelope.cursor);
          await writeEnvelope(envelope);
        }
        replayCursor = page.at(-1)?.cursor ?? replayCursor;
        if (page.length < 500) break;
      }

      for (const envelope of livePending.values()) {
        await writeEnvelope(envelope);
      }
      livePending.clear();
      replaying = false;

      heartbeat = setInterval(() => {
        if (closed || pendingWrites >= 2000) return;
        pendingWrites += 1;
        writeChain = writeChain
          .then(async () => {
            if (!closed && !res.write(': heartbeat\n\n')) {
              await once(res, 'drain');
            }
          })
          .catch(() => {
            cleanup();
          })
          .finally(() => {
            pendingWrites -= 1;
          });
      }, 15_000);
      heartbeat.unref();
    };

    start().catch((error) => {
      cleanup();
      if (!res.headersSent) {
        this.handleError(res, error);
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    });
  }

  /**
   * Real-time room message stream. Unlike `/api/events/stream` (which replays a
   * per-workspace event log), room messages live in the global store with no log
   * to replay — this stream pushes live watcher events only, and clients poll
   * at a low frequency as a fallback if the watcher is unavailable.
   */
  private streamRoomEvents(req: IncomingMessage, res: ServerResponse): void {
    let closed = false;
    let writeChain = Promise.resolve();
    let heartbeat: NodeJS.Timeout | undefined;
    const state = ensureRoomWatcher();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      state.listeners.delete(listener);
      this.eventResponses.delete(res);
    };

    const listener: RoomMessageListener = (payload) => {
      if (closed) return;
      writeChain = writeChain
        .then(async () => {
          if (closed) return;
          const frame = `event: room-event\ndata: ${JSON.stringify(payload)}\n\n`;
          if (!res.write(frame)) {
            await once(res, 'drain');
          }
        })
        .catch(() => {
          cleanup();
        });
    };

    res.once('close', cleanup);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    state.listeners.add(listener);
    this.eventResponses.add(res);

    heartbeat = setInterval(() => {
      if (closed) return;
      writeChain = writeChain
        .then(async () => {
          if (!closed && !res.write(': h\n\n')) {
            await once(res, 'drain');
          }
        })
        .catch(() => {
          cleanup();
        });
    }, 15_000);
    heartbeat.unref();
  }

  private async executeIdempotentCommand(
    context: MesaRuntimeContext,
    commandId: string,
    fingerprint: string,
    execute: () => unknown,
  ): Promise<StoredCommandResult> {
    return withLock(context, `command:${commandId}`, () => {
      const path = join(context.paths.logsDir, 'commands', `${encodeURIComponent(commandId)}.json`);
      const existing = context.storage.readText(path);
      if (existing) {
        const stored = JSON.parse(existing) as StoredCommandResult;
        if (stored.fingerprint !== fingerprint) {
          throw new MesaError('VALIDATION_ERROR', `Command ID ${commandId} was already used for another request`);
        }
        if (stored.status === 'completed') {
          return { ...stored, duplicate: true };
        }
        const recovered: StoredCommandResult = {
          ...stored,
          status: 'completed',
          duplicate: true,
          result: execute(),
        };
        context.storage.writeText(path, `${JSON.stringify(recovered, null, 2)}\n`);
        return recovered;
      }
      const pending: StoredCommandResult = {
        commandId,
        fingerprint,
        status: 'pending',
        accepted: true,
        duplicate: false,
      };
      context.storage.writeText(path, `${JSON.stringify(pending, null, 2)}\n`);
      const completed: StoredCommandResult = {
        ...pending,
        status: 'completed',
        result: execute(),
      };
      context.storage.writeText(path, `${JSON.stringify(completed, null, 2)}\n`);
      return completed;
    });
  }

  private isAuthorized(req: IncomingMessage, url: URL): boolean {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const isEventStream = url.pathname === '/api/events/stream' || url.pathname === '/api/rooms/events/stream';
    const streamToken = isEventStream
      ? url.searchParams.get('access_token') ?? undefined
      : undefined;
    return bearer === this.sessionToken || streamToken === this.sessionToken;
  }

  private parseLimit(url: URL): number {
    const raw = url.searchParams.get('limit');
    if (raw === null) {
      return 100;
    }
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MesaError('VALIDATION_ERROR', 'limit must be an integer between 1 and 1000');
    }
    return limit;
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) {
        throw new MesaError('VALIDATION_ERROR', 'Request body exceeds 1 MiB');
      }
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
    } catch {
      throw new MesaError('VALIDATION_ERROR', 'Request body must be valid JSON');
    }
  }

  private handleError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof MesaError) {
      const status = error.code === 'POLICY_DENIED' ? 403
        : error.code.endsWith('_NOT_FOUND') ? 404
          : error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_STATUS_TRANSITION' ? 400
            : 500;
      this.sendError(res, status, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ZodError' ? 400
      : message.includes('not found') ? 404
        : message.startsWith('Cannot ') ? 409
          : 500;
    this.sendError(res, status, message);
  }

  private sendJson(res: ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
