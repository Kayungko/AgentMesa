import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs';
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
  removeAgentFromMeeting,
  registerAgent,
  MesaError,
  withLock,
} from '@agentmesa/core';
import type { MesaWorkspace } from '@agentmesa/protocol';
import type { AgentRole, EventEnvelope, MeetingStatus, RoomMessage, RunStatus, TaskStatus, WorkflowDecisionCommand } from '@agentmesa/protocol';
import {
  CreateMeetingInputSchema,
  CreateMessageInputSchema,
  CreateTaskInputSchema,
  WorkflowDecisionCommandSchema,
} from '@agentmesa/protocol';
import type { MesaActor, MesaRuntimeContext } from '@agentmesa/core';
import { WorkflowEngine, decideWorkflow, listWorkflowStates } from '@agentmesa/orchestrator';
import { buildSessionPrompt, executeSessionRun } from '@agentmesa/runner';
import {
  getSetupStatus,
  installMcpIntegration,
  uninstallMcpIntegration,
  setRunnerCommands,
  isIntegrationSide,
  type RunnerCommandPatch,
} from '@agentmesa/setup';
import { generateDashboardHtml } from './dashboard.js';

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
    const readContext = this.createReadContext();

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
    // 防重：该 agent 在此会话已有进行中的 run 则跳过，避免重复 spawn。
    const hasActive = listAgentRuns(writeContext, { agentId })
      .filter((run) => run.meetingId === meetingId)
      .some((run) => run.status === 'pending' || run.status === 'running');
    if (hasActive) return;

    const meeting = getMeeting(writeContext, meetingId);
    const tasks = listTasks(writeContext).filter((task) => meeting.tasks.includes(task.id));
    const messages = listMessages(writeContext)
      .filter((message) => message.meetingId === meetingId)
      .slice(-20);
    const agentNames = Object.fromEntries(
      listAgents(writeContext).map((agent) => [agent.id, agent.name]),
    );

    const prompt = buildSessionPrompt({
      meetingId,
      title: meeting.title,
      purpose: meeting.purpose,
      agentId,
      agentNames,
      tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
      messages: messages.map((message) => ({
        from: message.from,
        type: message.type,
        summary: message.summary,
        createdAt: message.createdAt,
      })),
    });

    const run = createAgentRun(writeContext, {
      agentId,
      meetingId,
      input: prompt,
      action: 'custom',
      runnerType: 'session',
    });

    await executeSessionRun(writeContext, run.id, {
      writeBackToMeetingId: meetingId,
      timeout: this.sessionRunTimeout,
    });
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
      };
      const store = createRoomStore();
      const message = store.sendMessage(roomMessageMatch[1]!, {
        workspaceId: body.workspaceId,
        from: body.from,
        summary: body.summary,
        ...(typeof body.type === 'string' ? { type: body.type } : {}),
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
