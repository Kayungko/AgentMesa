/**
 * M4 Deep Orchestration — Claude Agent SDK driver.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` as a persistent
 * `AgentDriverSession`. Verified API shape (sdk.d.ts of
 * @anthropic-ai/claude-agent-sdk@0.3.251):
 *
 * - `query({ prompt, options })` returns `Query extends
 *   AsyncGenerator<SDKMessage, void>`; each query() call spawns one backend
 *   CLI turn and the process exits after the turn in single-prompt mode.
 * - `Options`: `cwd`, `resume` (session id), `systemPrompt`, `abortController`,
 *   `permissionMode`, `canUseTool(toolName, input, ctx) => PermissionResult`.
 * - Session id arrives on the `system/init` message (and on every
 *   assistant/result message as `session_id`).
 * - `SDKAssistantMessage.message.content` holds Anthropic content blocks
 *   (`text`, `thinking` with `.thinking`, `tool_use` with `.name`/`.input`).
 * - One `result` message ends the turn: `subtype: 'success'` carries the
 *   final text in `result`; error subtypes carry `errors: string[]`.
 * - `PermissionResult` deny requires a `message: string`.
 *
 * Design notes:
 *
 * - **Lazy session establishment.** The SDK is per-query: there is no
 *   `createSession` RPC. The backend session id only exists once the first
 *   query() emits its `system/init` message. `createSession()` therefore
 *   returns a session whose `backendSessionId` is an empty-string placeholder
 *   until the first turn observes the init message; every later turn passes
 *   `resume: <captured id>` so the multi-turn thread continues. Persist the
 *   handle only after the first turn completes (empty id cannot be resumed).
 * - **Permission bridge.** `canUseTool` runs on the SDK side while our event
 *   stream is being consumed. We push a `permission_request` event onto an
 *   internal queue and suspend the SDK callback on a promise stored in a
 *   pending map; `respondPermission()` resolves it and the decision flows
 *   back to the SDK. Because the pump task pushes both message-derived events
 *   and permission events through the same queue, the consumer always sees
 *   the request while the turn is stalled — no deadlock.
 * - **No top-level SDK import.** The SDK is loaded through an injectable
 *   dynamic-import thunk so `isAvailable()` stays cheap and never triggers a
 *   load of the real backend in tests.
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

// ---------------------------------------------------------------------------
// Structural (duck-typed) SDK surface.
//
// Deliberately local: tests inject fakes that satisfy these shapes, and the
// real SDK types are structurally compatible at the single cast boundary in
// `defaultSdkImport`. Keeps the driver compiling even if the SDK's exact type
// names shift between minor versions.
// ---------------------------------------------------------------------------

/** Content block subset we map to events. */
export interface SdkContentBlockLike {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}

/** Message subset the driver understands; everything else is ignored. */
export type SdkMessageLike =
  | { type: 'system'; subtype?: string; session_id?: string }
  | {
      type: 'assistant';
      message?: { content?: readonly SdkContentBlockLike[] };
      session_id?: string;
    }
  | {
      type: 'result';
      subtype?: string;
      is_error?: boolean;
      result?: string;
      errors?: string[];
      session_id?: string;
    }
  | { type: string; [extra: string]: unknown };

/** `PermissionResult` subset returned from `canUseTool`. */
export type SdkPermissionResultLike =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/** `canUseTool` context subset the bridge consumes. */
export interface SdkCanUseToolContextLike {
  signal: AbortSignal;
  toolUseID?: string;
  requestId?: string;
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  suggestions?: unknown;
}

/** `Options` subset the driver forwards. */
export interface SdkQueryOptionsLike {
  cwd?: string;
  resume?: string;
  systemPrompt?: string;
  permissionMode?: string;
  abortController?: AbortController;
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    context: SdkCanUseToolContextLike
  ) => Promise<SdkPermissionResultLike | null>;
}

/** Injectable `query` entry point. */
export type SdkQueryFn = (params: {
  prompt: string;
  options?: SdkQueryOptionsLike;
}) => AsyncIterable<SdkMessageLike>;

/** Injectable module loader (defaults to the real dynamic import). */
export type SdkImportFn = () => Promise<{ query?: unknown }>;

const defaultSdkImport: SdkImportFn = () =>
  // Dynamic on purpose: keeps the SDK out of the module graph so the
  // `isAvailable() === false` path (SDK not installed) never loads it.
  import('@anthropic-ai/claude-agent-sdk') as Promise<{ query?: unknown }>;

// ---------------------------------------------------------------------------
// Internal event queue: lets the pump task (SDK stream + canUseTool bridge)
// push events while the consumer pulls them.
// ---------------------------------------------------------------------------

class DriverEventQueue implements AsyncIterableIterator<DriverEvent> {
  private buffered: DriverEvent[] = [];
  private waiters: Array<(result: IteratorResult<DriverEvent>) => void> = [];
  private finished = false;

  push(event: DriverEvent): void {
    if (this.finished) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.buffered.push(event);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<DriverEvent>> {
    const event = this.buffered.shift();
    if (event !== undefined) return Promise.resolve({ value: event, done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<DriverEvent> {
    return this;
  }
}

// ---------------------------------------------------------------------------
// SDKMessage -> DriverEvent mapping.
// ---------------------------------------------------------------------------

interface MappedMessage {
  events: DriverEvent[];
  /** True when the message was a result (turn terminal). */
  isResult: boolean;
}

function mapSdkMessage(
  message: SdkMessageLike,
  onSessionId: (sessionId: string) => void
): MappedMessage {
  const events: DriverEvent[] = [];
  if (message === null || typeof message !== 'object') return { events, isResult: false };

  if (message.type === 'system') {
    const sessionId = (message as { session_id?: unknown }).session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) onSessionId(sessionId);
    return { events, isResult: false };
  }

  if (message.type === 'assistant') {
    const assistant = message as {
      message?: { content?: unknown };
      session_id?: unknown;
    };
    const sessionId = assistant.session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) onSessionId(sessionId);
    const content = assistant.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as SdkContentBlockLike[]) {
        if (block === null || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ type: 'text', text: block.text });
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          events.push({ type: 'thinking', text: block.thinking });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          events.push({ type: 'tool_use', tool: block.name, input: block.input });
        }
        // redacted_thinking / server tool blocks: not surfaced.
      }
    }
    return { events, isResult: false };
  }

  if (message.type === 'result') {
    const result = message as {
      subtype?: unknown;
      is_error?: unknown;
      result?: unknown;
      errors?: unknown;
      session_id?: unknown;
    };
    const sessionId = result.session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) onSessionId(sessionId);
    const subtype = typeof result.subtype === 'string' ? result.subtype : 'unknown';
    const isError = result.is_error === true || subtype !== 'success';
    let summary: string;
    if (!isError) {
      summary = typeof result.result === 'string' ? result.result : '';
    } else {
      const parts: string[] = [];
      if (typeof result.result === 'string' && result.result.length > 0) parts.push(result.result);
      if (Array.isArray(result.errors)) {
        for (const err of result.errors) if (typeof err === 'string') parts.push(err);
      }
      summary = parts.length > 0 ? parts.join('; ') : `turn failed (${subtype})`;
    }
    events.push({ type: 'turn_complete', success: !isError, summary });
    return { events, isResult: true };
  }

  return { events, isResult: false };
}

// ---------------------------------------------------------------------------
// Driver + session.
// ---------------------------------------------------------------------------

interface ActiveTurn {
  abortController: AbortController;
  queue: DriverEventQueue;
  /** Why abort was requested: distinguishes interrupt/timeout/close in summaries. */
  abortReason: 'interrupt' | 'timeout' | 'close' | null;
  sawResult: boolean;
  permissionSeq: number;
}

interface PendingPermission {
  turn: ActiveTurn;
  resolve: (decision: { decision: 'allow' | 'deny'; message?: string }) => void;
}

export interface ClaudeSdkDriverOptions {
  /** Test seam: inject a fake `query` stream factory. */
  queryFn?: SdkQueryFn;
  /** Test seam: inject the dynamic SDK import (availability probe). */
  sdkImport?: SdkImportFn;
}

/** `AgentDriver` implementation backed by the Claude Agent SDK. */
export class ClaudeSdkDriver implements AgentDriver {
  readonly kind = 'claude-agent-sdk' as const;
  readonly name = 'claude-agent-sdk';

  private readonly injectedQueryFn?: SdkQueryFn;
  private readonly sdkImport: SdkImportFn;

  constructor(options: ClaudeSdkDriverOptions = {}) {
    this.injectedQueryFn = options.queryFn;
    this.sdkImport = options.sdkImport ?? defaultSdkImport;
  }

  async isAvailable(): Promise<boolean> {
    if (this.injectedQueryFn) return true;
    try {
      const mod = await this.sdkImport();
      return mod !== null && typeof mod === 'object' && typeof mod.query === 'function';
    } catch {
      return false;
    }
  }

  async createSession(init: DriverSessionInit): Promise<AgentDriverSession> {
    const queryFn = await this.resolveQueryFn();
    // backendSessionId stays '' (placeholder) until the first turn's
    // system/init message reports the SDK-assigned session id.
    return new ClaudeSdkSession(init, queryFn, '');
  }

  async resumeSession(handle: DriverSessionHandle, init: DriverSessionInit): Promise<AgentDriverSession> {
    if (handle.kind !== this.kind) {
      throw new Error(`handle kind mismatch: expected ${this.kind}, got ${handle.kind}`);
    }
    if (!handle.backendSessionId) {
      throw new Error('cannot resume: handle has no backendSessionId (persist handles only after the first turn)');
    }
    const queryFn = await this.resolveQueryFn();
    return new ClaudeSdkSession(init, queryFn, handle.backendSessionId);
  }

  private async resolveQueryFn(): Promise<SdkQueryFn> {
    if (this.injectedQueryFn) return this.injectedQueryFn;
    const mod = await this.sdkImport();
    const query = mod?.query;
    if (typeof query !== 'function') {
      throw new Error('@anthropic-ai/claude-agent-sdk did not expose query(); is it installed?');
    }
    return query as SdkQueryFn;
  }
}

class ClaudeSdkSession implements AgentDriverSession {
  readonly kind = 'claude-agent-sdk' as const;

  private readonly init: DriverSessionInit;
  private readonly queryFn: SdkQueryFn;
  private readonly createdAt: string;
  /** Placeholder '' until the first turn observes the backend session id. */
  private capturedSessionId: string;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private activeTurn: ActiveTurn | null = null;
  private closed = false;

  constructor(init: DriverSessionInit, queryFn: SdkQueryFn, backendSessionId: string) {
    this.init = init;
    this.queryFn = queryFn;
    this.capturedSessionId = backendSessionId;
    this.createdAt = new Date().toISOString();
  }

  get backendSessionId(): string {
    return this.capturedSessionId;
  }

  handle(): DriverSessionHandle {
    return {
      kind: this.kind,
      backendSessionId: this.capturedSessionId,
      createdAt: this.createdAt,
    };
  }

  async *send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent> {
    if (this.closed) throw new Error('session is closed');
    if (this.activeTurn) throw new Error('a turn is already in flight for this session');

    const turn: ActiveTurn = {
      abortController: new AbortController(),
      queue: new DriverEventQueue(),
      abortReason: null,
      sawResult: false,
      permissionSeq: 0,
    };
    this.activeTurn = turn;

    // Pump runs independently of consumer pull rate; events buffer in the queue.
    void this.runTurn(turn, input).catch(() => {
      // runTurn never rejects by construction; defensive only.
      turn.queue.push({ type: 'error', message: 'internal driver error', fatal: true });
      turn.queue.finish();
    });

    try {
      for await (const event of turn.queue) {
        yield event;
      }
    } finally {
      if (this.activeTurn === turn) this.activeTurn = null;
      // Consumer bailed without draining (break/throw): stop the backend turn.
      if (!turn.sawResult && !turn.abortController.signal.aborted) {
        turn.abortReason ??= 'interrupt';
        turn.abortController.abort();
      }
    }
  }

  async respondPermission(requestId: string, decision: 'allow' | 'deny', message?: string): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`no pending permission request: ${requestId}`);
    }
    this.pendingPermissions.delete(requestId);
    pending.resolve({ decision, message });
  }

  async interrupt(): Promise<void> {
    const turn = this.activeTurn;
    if (!turn) return;
    turn.abortReason ??= 'interrupt';
    turn.abortController.abort();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const turn = this.activeTurn;
    if (turn) {
      turn.abortReason ??= 'close';
      turn.abortController.abort();
    }
  }

  // -------------------------------------------------------------------------

  private async runTurn(turn: ActiveTurn, input: DriverTurnInput): Promise<void> {
    const { queue } = turn;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
        timer = setTimeout(() => {
          turn.abortReason ??= 'timeout';
          turn.abortController.abort();
        }, input.timeoutMs);
      }

      const options: SdkQueryOptionsLike = {
        cwd: this.init.cwd,
        abortController: turn.abortController,
      };
      if (this.init.systemPrompt !== undefined) options.systemPrompt = this.init.systemPrompt;
      if (this.init.requirePermissions) options.permissionMode = 'default';
      // SDK is per-query: every turn after the first must resume the captured
      // backend session id to continue the same conversation thread.
      if (this.capturedSessionId) options.resume = this.capturedSessionId;
      options.canUseTool = (toolName, toolInput, context) =>
        this.handleCanUseTool(turn, toolName, toolInput, context);

      const stream = this.queryFn({ prompt: input.prompt, options });
      for await (const message of stream) {
        const mapped = mapSdkMessage(message, (sessionId) => this.captureSessionId(sessionId));
        if (mapped.isResult) turn.sawResult = true;
        for (const event of mapped.events) queue.push(event);
      }

      if (!turn.sawResult) {
        // Stream ended without a result message (abort or backend quirk).
        const summary =
          turn.abortReason === 'interrupt'
            ? 'interrupted by user'
            : turn.abortReason === 'timeout'
              ? 'turn timed out'
              : turn.abortReason === 'close'
                ? 'session closed'
                : 'stream ended without a result message';
        queue.push({ type: 'turn_complete', success: false, summary });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const summary =
        turn.abortReason === 'interrupt'
          ? 'interrupted by user'
          : turn.abortReason === 'timeout'
            ? `turn timed out after ${String(input.timeoutMs)}ms`
            : turn.abortReason === 'close'
              ? 'session closed'
              : message;
      if (turn.abortReason === null) {
        queue.push({ type: 'error', message, fatal: true });
      }
      if (!turn.sawResult) {
        queue.push({ type: 'turn_complete', success: false, summary });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Unstick any SDK canUseTool callback still awaiting a Mesa answer.
      for (const [requestId, pending] of this.pendingPermissions) {
        if (pending.turn === turn) {
          this.pendingPermissions.delete(requestId);
          pending.resolve({ decision: 'deny', message: 'turn ended before permission was answered' });
        }
      }
      queue.finish();
    }
  }

  private captureSessionId(sessionId: string): void {
    // Update on every message: resumed sessions keep reporting their id, and
    // a forked id (if ever produced) supersedes the stored one.
    this.capturedSessionId = sessionId;
  }

  private async handleCanUseTool(
    turn: ActiveTurn,
    toolName: string,
    toolInput: Record<string, unknown>,
    context: SdkCanUseToolContextLike
  ): Promise<SdkPermissionResultLike> {
    turn.permissionSeq += 1;
    const requestId =
      context.toolUseID !== undefined && context.toolUseID.length > 0
        ? `${toolName}:${context.toolUseID}`
        : `${toolName}:#${String(turn.permissionSeq)}`;

    const request: DriverPermissionRequest = {
      requestId,
      kind: 'tool',
      title: context.title !== undefined ? context.title : `${toolName}: ${summarizeToolInput(toolInput)}`,
      detail: {
        toolName,
        input: toolInput,
        toolUseID: context.toolUseID,
        displayName: context.displayName,
        description: context.description,
        decisionReason: context.decisionReason,
        blockedPath: context.blockedPath,
        suggestions: context.suggestions,
      },
    };

    const decision = await new Promise<{ decision: 'allow' | 'deny'; message?: string }>((resolve) => {
      const pending: PendingPermission = { turn, resolve };
      this.pendingPermissions.set(requestId, pending);
      // If the SDK aborts the permission op (interrupt/timeout), unstick it.
      context.signal.addEventListener('abort', () => {
        if (this.pendingPermissions.get(requestId) === pending) {
          this.pendingPermissions.delete(requestId);
          resolve({ decision: 'deny', message: 'permission request aborted' });
        }
      });
      queuePush(turn, { type: 'permission_request', request });
    });

    if (decision.decision === 'allow') {
      return { behavior: 'allow' };
    }
    return {
      behavior: 'deny',
      message: decision.message !== undefined && decision.message.length > 0 ? decision.message : 'Denied by Mesa',
    };
  }
}

function queuePush(turn: ActiveTurn, event: DriverEvent): void {
  turn.queue.push(event);
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const preferred = ['command', 'file_path', 'path', 'pattern', 'url', 'description'];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  try {
    const json = JSON.stringify(input);
    return json === undefined ? '{}' : json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return '{}';
  }
}
