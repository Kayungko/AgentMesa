/**
 * M4 deep driver: `codex app-server` (Rust binary, JSON-RPC 2.0 over stdio).
 *
 * One child process per session: createSession / resumeSession each spawn and
 * handshake a fresh app-server connection. Method names and wire shapes live
 * in ./codex-app-server-protocol.ts (the protocol adapter boundary); this file
 * only orchestrates the AgentDriver / AgentDriverSession contract from
 * ./types.ts.
 *
 * Command resolution order: env `AGENTMESA_CODEX_APP_SERVER_CMD` >
 * constructor `command` option > default `codex app-server`. NOTE: core's
 * MesaConfig.runners currently only exposes claudeCmd/codexCmd; when core
 * grows a `codexAppServerCmd` field the caller reads it and passes it as the
 * constructor `command` option (core was intentionally left untouched).
 */

import type {
  AgentDriver,
  AgentDriverSession,
  DriverEvent,
  DriverPermissionRequest,
  DriverSessionHandle,
  DriverSessionInit,
  DriverTurnInput,
} from './types.js';
import {
  CODEX_APPROVAL_DECISIONS,
  CODEX_METHODS,
  JsonRpcConnection,
  defaultSpawn,
  isCommandAvailable,
  parseCommandSpec,
  type ApprovalDecisionResponse,
  type CommandApprovalParams,
  type CommandSpec,
  type CodexThread,
  type CodexThreadItem,
  type FileChangeApprovalParams,
  type InitializeParams,
  type ItemLifecycleParams,
  type JsonRpcConnectionHooks,
  type PermissionsApprovalParams,
  type PermissionsGrantResponse,
  type SpawnFn,
  type ThreadStartParams,
  type ThreadResumeParams,
  type TurnLifecycleParams,
  type TurnStartParams,
} from './codex-app-server-protocol.js';

export interface CodexAppServerDriverOptions {
  /** Full command line, e.g. `codex app-server` or `node mock.mjs`. */
  command?: string;
  /** Injectable spawn for tests; defaults to child_process.spawn. */
  spawnFn?: SpawnFn;
  /** Per-request JSON-RPC timeout (handshake, thread/start, turn/start...). */
  requestTimeoutMs?: number;
  /** Grace window for close() before escalating to SIGTERM/SIGKILL. */
  closeGraceMs?: number;
  /** Grace window after a timed-out turn's interrupt before failing hard. */
  interruptGraceMs?: number;
}

const DEFAULT_COMMAND = 'codex app-server';
const CLIENT_INFO: InitializeParams = {
  clientInfo: { name: 'agentmesa', title: 'AgentMesa', version: '0.1.0' },
  // Required for thread/resume.excludeTurns (verified against codex-cli
  // 0.131.0 — see InitializeParams.capabilities).
  capabilities: { experimentalApi: true },
};

interface PendingPermission {
  serverId: string | number;
  kind: DriverPermissionRequest['kind'];
  method: string;
  /** Raw permissions profile requested (item/permissions/requestApproval only). */
  requestedPermissions?: unknown;
  /** Set when the server cleared the request (serverRequest/resolved) — respondPermission becomes a no-op. */
  stale: boolean;
}

interface ActiveTurn {
  turnId: string | null;
  queue: DriverEvent[];
  done: boolean;
  permissions: Map<string, PendingPermission>;
  agentDeltasSeen: Set<string>;
  reasoningDeltasSeen: Set<string>;
  /**
   * itemId → latest `changes` seen on a fileChange item. The
   * `item/fileChange/requestApproval` payload carries no file paths (only the
   * itemId), so the item's own changes — observed on the preceding lifecycle
   * events — are the only source of per-path granularity for the permission
   * bridge. Without this, patch checks degrade to the whole grantRoot.
   */
  fileChanges: Map<string, unknown>;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  hardFailTimer: ReturnType<typeof setTimeout> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class CodexAppServerDriver implements AgentDriver {
  readonly kind = 'codex-app-server' as const;
  readonly name = 'codex-app-server';

  private readonly commandLine: string;
  private readonly spawnFn: SpawnFn;
  private readonly requestTimeoutMs: number | undefined;
  private readonly closeGraceMs: number | undefined;
  private readonly interruptGraceMs: number;

  constructor(options: CodexAppServerDriverOptions = {}) {
    const env = process.env['AGENTMESA_CODEX_APP_SERVER_CMD']?.trim();
    this.commandLine = env || options.command?.trim() || DEFAULT_COMMAND;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.closeGraceMs = options.closeGraceMs;
    this.interruptGraceMs = options.interruptGraceMs ?? 5000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const spec = parseCommandSpec(this.commandLine);
      return await isCommandAvailable(spec, this.spawnFn);
    } catch {
      return false;
    }
  }

  async createSession(init: DriverSessionInit): Promise<AgentDriverSession> {
    const { connection, hooks, threadId } = await this.connectAndOpenThread(init, { kind: 'start' });
    return new CodexAppServerSession(connection, hooks, threadId, init, {
      closeGraceMs: this.closeGraceMs,
      interruptGraceMs: this.interruptGraceMs,
    });
  }

  async resumeSession(handle: DriverSessionHandle, init: DriverSessionInit): Promise<AgentDriverSession> {
    if (handle.kind !== 'codex-app-server') {
      throw new Error(`codex-app-server driver cannot resume a ${handle.kind} session`);
    }
    const { connection, hooks, threadId } = await this.connectAndOpenThread(init, {
      kind: 'resume',
      threadId: handle.backendSessionId,
    });
    return new CodexAppServerSession(connection, hooks, threadId, init, {
      closeGraceMs: this.closeGraceMs,
      interruptGraceMs: this.interruptGraceMs,
    });
  }

  /**
   * Cheap adoption precheck: spawn an app-server, handshake, run
   * `thread/resume` (excludeTurns) against the thread id, close. Throws when
   * the resume cannot possibly succeed (unknown thread, protocol failure,
   * command missing); resolves otherwise. No session object is created and no
   * state is persisted — this is a probe, not a takeover.
   */
  async probeResume(threadId: string, cwd: string): Promise<void> {
    const { connection } = await this.connectAndOpenThread({ cwd }, {
      kind: 'resume',
      threadId,
    });
    await connection.close(this.closeGraceMs ?? 1500);
  }

  private async connectAndOpenThread(
    init: DriverSessionInit,
    target: { kind: 'start' } | { kind: 'resume'; threadId: string }
  ): Promise<{ connection: JsonRpcConnection; hooks: JsonRpcConnectionHooks; threadId: string }> {
    const spec: CommandSpec = parseCommandSpec(this.commandLine);
    // Mutable hook object: rebound to the session once it exists, so
    // notifications arriving mid-handshake never get lost.
    const hooks: JsonRpcConnectionHooks = {
      onNotification: () => undefined,
      onServerRequest: (id, method) => {
        // No session attached yet; refuse instead of stalling the server.
        connection.respondServerError(id, -32601, `method not supported: ${method}`);
      },
      onFatal: () => undefined,
    };
    const connection = new JsonRpcConnection(spec, this.spawnFn, hooks, {
      cwd: init.cwd,
      requestTimeoutMs: this.requestTimeoutMs,
    });
    try {
      await connection.request(CODEX_METHODS.initialize, CLIENT_INFO);
      connection.notify(CODEX_METHODS.initialized);
      if (target.kind === 'start') {
        const params: ThreadStartParams = { cwd: init.cwd };
        if (init.requirePermissions === true) {
          // Surface every gated action as an approval request (verified wire
          // values: untrusted | on-request | never).
          params.approvalPolicy = 'on-request';
        }
        const result = asRecord(await connection.request(CODEX_METHODS.threadStart, params));
        const thread = asRecord(result?.['thread']) as CodexThread | null;
        const threadId = str(thread?.['id']);
        if (!threadId) throw new Error('thread/start response missing thread.id');
        return { connection, hooks, threadId };
      }
      const params: ThreadResumeParams = { threadId: target.threadId, excludeTurns: true };
      const result = asRecord(await connection.request(CODEX_METHODS.threadResume, params));
      const thread = asRecord(result?.['thread']) as CodexThread | null;
      const threadId = str(thread?.['id']) ?? target.threadId;
      return { connection, hooks, threadId };
    } catch (error) {
      await connection.close(this.closeGraceMs ?? 1500);
      throw error;
    }
  }
}

class CodexAppServerSession implements AgentDriverSession {
  readonly kind = 'codex-app-server' as const;

  private closed = false;
  private activeTurn: ActiveTurn | null = null;
  private systemPromptPending: string | null;
  /** Turn-level approval posture (set when the session init required permissions). */
  private readonly requirePermissions: boolean;
  /** Wakes the event generator when queue state changes. */
  private resolveWait: (() => void) | null = null;
  private waitPromise: Promise<void> | null = null;

  constructor(
    private readonly connection: JsonRpcConnection,
    hooks: JsonRpcConnectionHooks,
    readonly backendSessionId: string,
    init: DriverSessionInit,
    private readonly options: { closeGraceMs?: number; interruptGraceMs: number }
  ) {
    this.systemPromptPending = init.systemPrompt?.trim() ? init.systemPrompt : null;
    this.requirePermissions = init.requirePermissions === true;
    hooks.onNotification = (method, params) => this.handleNotification(method, params);
    hooks.onServerRequest = (id, method, params) => this.handleServerRequest(id, method, params);
    hooks.onFatal = (error) => this.handleFatal(error);
  }

  handle(): DriverSessionHandle {
    return {
      kind: 'codex-app-server',
      backendSessionId: this.backendSessionId,
      createdAt: new Date().toISOString(),
    };
  }

  async *send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent> {
    if (this.closed) {
      throw new Error('codex app-server session is closed');
    }
    if (this.activeTurn) {
      throw new Error('a turn is already in progress on this codex app-server session');
    }
    const active: ActiveTurn = {
      turnId: null,
      queue: [],
      done: false,
      permissions: new Map(),
      agentDeltasSeen: new Set(),
      reasoningDeltasSeen: new Set(),
      fileChanges: new Map(),
      timeoutTimer: null,
      hardFailTimer: null,
    };
    this.activeTurn = active;

    try {
      // v2 thread/start has no system-prompt/instructions field (verified in
      // protocol sources), so the Mesa preamble is prepended to the first
      // turn's user message.
      const prompt = this.systemPromptPending ? `${this.systemPromptPending}\n\n${input.prompt}` : input.prompt;
      this.systemPromptPending = null;
      const params: TurnStartParams = {
        threadId: this.backendSessionId,
        input: [{ type: 'text', text: prompt }],
      };
      if (this.requirePermissions) {
        // Approval-posture lift: thread/resume carries no effective
        // approvalPolicy (verified against codex-cli 0.131.0 — accepted but
        // neither echoed nor persisted), so the turn level is the only
        // reliable place to put a resumed external session onto on-request
        // approval. For freshly created threads this matches the
        // thread/start posture and is therefore a no-op.
        params.approvalPolicy = 'on-request';
      }
      const result = asRecord(await this.connection.request(CODEX_METHODS.turnStart, params));
      const turn = asRecord(result?.['turn']);
      active.turnId = str(turn?.['id']) ?? null;
      if (input.timeoutMs !== undefined && input.timeoutMs > 0) {
        active.timeoutTimer = setTimeout(() => {
          void this.handleTurnTimeout(active);
        }, input.timeoutMs);
      }

      while (true) {
        while (active.queue.length > 0) {
          const event = active.queue.shift();
          if (event) yield event;
        }
        if (active.done) return;
        if (!this.waitPromise) {
          this.waitPromise = new Promise<void>((resolve) => {
            this.resolveWait = resolve;
          });
        }
        await this.waitPromise;
      }
    } finally {
      this.clearTurnTimers(active);
      if (this.activeTurn === active) this.activeTurn = null;
    }
  }

  async respondPermission(requestId: string, decision: 'allow' | 'deny', _message?: string): Promise<void> {
    const active = this.activeTurn;
    if (!active) throw new Error(`no active turn for permission response ${requestId}`);
    const pending = active.permissions.get(requestId);
    if (!pending) throw new Error(`unknown permission request ${requestId}`);
    if (pending.stale) return;
    active.permissions.delete(requestId);
    if (pending.method === CODEX_METHODS.permissionsRequestApproval) {
      // Permission grants answer with the granted subset; omitted = denied.
      const response: PermissionsGrantResponse =
        decision === 'allow'
          ? { scope: 'turn', permissions: pending.requestedPermissions ?? {} }
          : { permissions: {} };
      this.connection.respondServerRequest(pending.serverId, response);
      return;
    }
    const response: ApprovalDecisionResponse = {
      decision: decision === 'allow' ? CODEX_APPROVAL_DECISIONS.accept : CODEX_APPROVAL_DECISIONS.decline,
    };
    this.connection.respondServerRequest(pending.serverId, response);
  }

  async interrupt(): Promise<void> {
    const active = this.activeTurn;
    if (!active || active.done) return;
    if (active.turnId) {
      try {
        await this.connection.request(CODEX_METHODS.turnInterrupt, {
          threadId: this.backendSessionId,
          turnId: active.turnId,
        });
        // Verified behavior: the server then emits turn/completed with
        // status "interrupted", which the event loop maps to turn_complete.
        return;
      } catch {
        // Connection degraded — terminate the stream locally.
      }
    }
    this.endTurn(active, { type: 'error', message: 'codex app-server turn interrupt failed', fatal: true });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const active = this.activeTurn;
    if (active) {
      for (const [, pending] of active.permissions) pending.stale = true;
      active.permissions.clear();
      this.clearTurnTimers(active);
      if (!active.done) {
        active.queue.push({ type: 'error', message: 'codex app-server session closed', fatal: true });
        active.done = true;
        this.notifyQueue();
      }
    }
    await this.connection.close(this.options.closeGraceMs ?? 1500);
  }

  // -------------------------------------------------------------------------
  // Connection callbacks
  // -------------------------------------------------------------------------

  handleNotification(method: string, params: unknown): void {
    const p = asRecord(params);
    const threadId = str(p?.['threadId']);
    if (threadId && threadId !== this.backendSessionId) return;
    const active = this.activeTurn;
    switch (method) {
      case CODEX_METHODS.turnCompleted: {
        if (!active) return;
        const lifecycle = p as unknown as TurnLifecycleParams;
        this.completeTurn(active, asRecord(lifecycle?.['turn']));
        return;
      }
      case CODEX_METHODS.itemStarted:
      case CODEX_METHODS.itemCompleted: {
        if (!active) return;
        const lifecycle = p as unknown as ItemLifecycleParams;
        const item = asRecord(lifecycle?.['item']) as CodexThreadItem | null;
        if (!item) return;
        this.handleItem(active, method === CODEX_METHODS.itemStarted ? 'started' : 'completed', item);
        return;
      }
      case CODEX_METHODS.agentMessageDelta: {
        if (!active) return;
        const delta = str(p?.['delta']) ?? '';
        const itemId = str(p?.['itemId']);
        if (itemId) active.agentDeltasSeen.add(itemId);
        if (delta) {
          active.queue.push({ type: 'text', text: delta });
          this.notifyQueue();
        }
        return;
      }
      case CODEX_METHODS.reasoningSummaryTextDelta: {
        if (!active) return;
        const delta = str(p?.['delta']) ?? '';
        const itemId = str(p?.['itemId']);
        if (itemId) active.reasoningDeltasSeen.add(itemId);
        if (delta) {
          active.queue.push({ type: 'thinking', text: delta });
          this.notifyQueue();
        }
        return;
      }
      case CODEX_METHODS.error: {
        if (!active) return;
        const err = asRecord(p?.['error']);
        const message = str(err?.['message']) ?? 'codex app-server error';
        const willRetry = p?.['willRetry'] === true;
        active.queue.push({ type: 'error', message, fatal: !willRetry });
        this.notifyQueue();
        // A terminal error is followed by turn/completed(status failed), so
        // the stream stays open until that terminal event arrives.
        return;
      }
      case CODEX_METHODS.serverRequestResolved: {
        if (!active) return;
        const requestId = p?.['requestId'];
        if (requestId === undefined) return;
        const pending = active.permissions.get(String(requestId));
        if (pending) pending.stale = true;
        return;
      }
      default:
        // thread/started, turn/started, other item deltas, experimental
        // notifications: not consumed by this driver.
        return;
    }
  }

  handleServerRequest(id: string | number, method: string, params: unknown): void {
    const p = asRecord(params);
    const threadId = str(p?.['threadId']);
    if (threadId && threadId !== this.backendSessionId) {
      this.connection.respondServerError(id, -32602, 'thread does not belong to this session');
      return;
    }
    const active = this.activeTurn;
    if (!active || active.done) {
      this.connection.respondServerError(id, -32601, 'no active turn to approve');
      return;
    }
    switch (method) {
      case CODEX_METHODS.commandExecutionRequestApproval: {
        const approval = p as CommandApprovalParams;
        const command =
          str(approval['command']) ?? str(approval['approvalId']) ?? str(approval['itemId']) ?? 'command';
        const request: DriverPermissionRequest = {
          requestId: String(id),
          kind: 'command',
          title: `command: ${command}`,
          detail: params,
        };
        active.permissions.set(String(id), {
          serverId: id,
          kind: 'command',
          method,
          stale: false,
        });
        active.queue.push({ type: 'permission_request', request });
        this.notifyQueue();
        return;
      }
      case CODEX_METHODS.fileChangeRequestApproval: {
        const approval = p as FileChangeApprovalParams;
        // The wire approval payload carries no file paths — reattach the
        // changes observed on the item's lifecycle events (keyed by itemId)
        // so the permission bridge judges per-path instead of per-grantRoot.
        // When the item was never seen (unexpected ordering), fall back to
        // the raw payload exactly as before.
        const itemId = str(approval['itemId']);
        const changes = itemId !== undefined ? active.fileChanges.get(itemId) : undefined;
        const detail =
          changes !== undefined ? { ...(asRecord(params) ?? {}), changes } : params;
        const request: DriverPermissionRequest = {
          requestId: String(id),
          kind: 'patch',
          title: `patch: ${itemId ?? 'file change'}`,
          detail,
        };
        active.permissions.set(String(id), {
          serverId: id,
          kind: 'patch',
          method,
          stale: false,
        });
        active.queue.push({ type: 'permission_request', request });
        this.notifyQueue();
        return;
      }
      case CODEX_METHODS.permissionsRequestApproval: {
        const approval = p as PermissionsApprovalParams;
        const request: DriverPermissionRequest = {
          requestId: String(id),
          kind: 'tool',
          title: `permissions: ${str(approval['reason']) ?? 'requested permissions'}`,
          detail: params,
        };
        active.permissions.set(String(id), {
          serverId: id,
          kind: 'tool',
          method,
          requestedPermissions: approval['permissions'],
          stale: false,
        });
        active.queue.push({ type: 'permission_request', request });
        this.notifyQueue();
        return;
      }
      default:
        // Dynamic tool calls, MCP elicitations, attestation...: unsupported;
        // refusing keeps the server unblocked instead of hanging the turn.
        this.connection.respondServerError(id, -32601, `method not supported: ${method}`);
        return;
    }
  }

  handleFatal(error: Error): void {
    const active = this.activeTurn;
    if (!active || active.done) return;
    for (const [, pending] of active.permissions) pending.stale = true;
    active.permissions.clear();
    this.clearTurnTimers(active);
    active.queue.push({ type: 'error', message: error.message, fatal: true });
    active.done = true;
    this.notifyQueue();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private notifyQueue(): void {
    if (this.resolveWait) {
      const resolve = this.resolveWait;
      this.resolveWait = null;
      this.waitPromise = null;
      resolve();
    }
  }

  private clearTurnTimers(active: ActiveTurn): void {
    if (active.timeoutTimer) {
      clearTimeout(active.timeoutTimer);
      active.timeoutTimer = null;
    }
    if (active.hardFailTimer) {
      clearTimeout(active.hardFailTimer);
      active.hardFailTimer = null;
    }
  }

  private handleItem(active: ActiveTurn, phase: 'started' | 'completed', item: CodexThreadItem): void {
    const type = str(item['type']);
    switch (type) {
      case 'agentMessage':
        if (phase === 'completed' && !active.agentDeltasSeen.has(item['id'])) {
          const text = str(item['text']) ?? '';
          if (text) {
            active.queue.push({ type: 'text', text });
            this.notifyQueue();
          }
        }
        return;
      case 'reasoning':
        if (phase === 'completed' && !active.reasoningDeltasSeen.has(item['id'])) {
          const summary =
            str(item['summary']) ?? (typeof item['content'] === 'string' ? (item['content'] as string) : '');
          if (summary) {
            active.queue.push({ type: 'thinking', text: summary });
            this.notifyQueue();
          }
        }
        return;
      case 'commandExecution':
        if (phase === 'started') {
          active.queue.push({
            type: 'tool_use',
            tool: 'commandExecution',
            input: { command: item['command'], cwd: item['cwd'], status: item['status'] },
          });
          this.notifyQueue();
        }
        return;
      case 'fileChange':
        // Track the item's changes (both phases — completed may refine them)
        // so a subsequent approval request can be attributed to real paths.
        if (item['changes'] !== undefined) {
          active.fileChanges.set(String(item['id']), item['changes']);
        }
        if (phase === 'started') {
          active.queue.push({
            type: 'tool_use',
            tool: 'fileChange',
            input: { changes: item['changes'], status: item['status'] },
          });
          this.notifyQueue();
        }
        return;
      case 'mcpToolCall':
        if (phase === 'started') {
          active.queue.push({
            type: 'tool_use',
            tool: str(item['tool']) ?? 'mcpToolCall',
            input: item['arguments'],
          });
          this.notifyQueue();
        }
        return;
      default:
        return;
    }
  }

  private completeTurn(active: ActiveTurn, turn: Record<string, unknown> | null): void {
    if (active.done) return;
    this.clearTurnTimers(active);
    const status = str(turn?.['status']) ?? 'completed';
    const success = status === 'completed';
    let summary: string;
    if (status === 'failed') {
      const error = asRecord(turn?.['error']);
      summary = str(error?.['message']) ?? 'turn failed';
    } else if (status === 'interrupted') {
      summary = 'turn interrupted';
    } else {
      // Verified: turn/completed carries the final agent message as a
      // summary fallback inside turn.items.
      const items = Array.isArray(turn?.['items']) ? (turn['items'] as unknown[]) : [];
      let lastMessage: string | undefined;
      for (const raw of items) {
        const item = asRecord(raw) as CodexThreadItem | null;
        if (item && str(item['type']) === 'agentMessage' && typeof item['text'] === 'string' && item['text']) {
          lastMessage = item['text'];
        }
      }
      summary = lastMessage ?? '';
    }
    active.queue.push({ type: 'turn_complete', success, summary });
    active.done = true;
    this.notifyQueue();
  }

  private endTurn(active: ActiveTurn, event: DriverEvent): void {
    if (active.done) return;
    this.clearTurnTimers(active);
    active.queue.push(event);
    active.done = true;
    this.notifyQueue();
  }

  private async handleTurnTimeout(active: ActiveTurn): Promise<void> {
    if (active.done) return;
    try {
      if (active.turnId) {
        await this.connection.request(CODEX_METHODS.turnInterrupt, {
          threadId: this.backendSessionId,
          turnId: active.turnId,
        });
      }
    } catch {
      // Interrupt failed — the hard-fail timer below ends the stream.
    }
    active.hardFailTimer = setTimeout(() => {
      this.endTurn(active, { type: 'error', message: 'turn timed out', fatal: true });
    }, this.options.interruptGraceMs);
  }
}
