/**
 * JSON-RPC 2.0 client + protocol adapter for `codex app-server`.
 *
 * Protocol facts below were verified against the official sources (see
 * codex-rs/app-server/README.md and codex-rs/app-server-protocol/src/protocol/**):
 *
 * - Transport: stdio, newline-delimited JSON. The `"jsonrpc":"2.0"` envelope
 *   header is OMITTED on the wire; messages are `{method,id?,params?}` /
 *   `{id,result|error}`.
 * - Handshake: one `initialize` request (params: `{clientInfo:{name,title,version}}`)
 *   per connection, then an `initialized` notification with NO params.
 * - Threads: `thread/start` (params incl. `cwd`, optional `approvalPolicy`) and
 *   `thread/resume` (params `{threadId}`); both respond `{thread:{id,...}}`.
 * - Turns: `turn/start` (params `{threadId, input:[{type:"text",text}]}`)
 *   responds `{turn:{id,status,items,error}}`; `turn/interrupt` (params
 *   `{threadId,turnId}`) responds `{}`.
 * - Approval policy wire values: `untrusted` | `on-request` | `never`
 *   (+ experimental `granular`), see AskForApproval in protocol/v2/shared.rs.
 * - Notifications: `thread/started`, `turn/started`/`turn/completed`
 *   (`{threadId, turn}`; turn.status is camelCase
 *   `completed|interrupted|failed|inProgress`), `item/started`/`item/completed`
 *   (`{item, threadId, turnId}`), `item/agentMessage/delta`,
 *   `item/reasoning/summaryTextDelta` (`{threadId, turnId, itemId, delta}`),
 *   `error` (`{error:{message}, willRetry, threadId, turnId}`),
 *   `serverRequest/resolved` (`{threadId, requestId}`).
 * - Server-initiated requests (client must answer by echoing the id):
 *   `item/commandExecution/requestApproval` (params incl. `kind`, `threadId`,
 *   `turnId`, `itemId`, `approvalId?`, `reason?`, `command?`, `cwd?`) and
 *   `item/fileChange/requestApproval` (params `{threadId, turnId, itemId,
 *   reason?}`) — both answered `{decision:"accept"|"acceptForSession"|"decline"|"cancel"}`;
 *   `item/permissions/requestApproval` answered with the granted permission
 *   subset `{scope?, permissions}` (omitted permissions are denied).
 *
 * Everything method-name-ish lives in `CODEX_METHODS` so a protocol drift can
 * be fixed in one place; payload decoding stays defensive (unknown fields are
 * ignored, missing optional fields tolerated).
 */

import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** Injectable spawn (defaults to node:child_process.spawn) for tests. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export const defaultSpawn: SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess => spawn(command, args, options);

/**
 * Central method-name table (the protocol adapter boundary). Verified against
 * the v2 app-server protocol; the legacy v1 surface (newConversation /
 * sendUserMessage / codex/event) is intentionally NOT used.
 */
export const CODEX_METHODS = {
  /** client -> server requests */
  initialize: 'initialize',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  turnStart: 'turn/start',
  turnInterrupt: 'turn/interrupt',
  /** client -> server notification */
  initialized: 'initialized',
  /** server -> client notifications */
  threadStarted: 'thread/started',
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  agentMessageDelta: 'item/agentMessage/delta',
  reasoningSummaryTextDelta: 'item/reasoning/summaryTextDelta',
  error: 'error',
  serverRequestResolved: 'serverRequest/resolved',
  /** server -> client requests */
  commandExecutionRequestApproval: 'item/commandExecution/requestApproval',
  fileChangeRequestApproval: 'item/fileChange/requestApproval',
  permissionsRequestApproval: 'item/permissions/requestApproval',
} as const;

export const CODEX_APPROVAL_DECISIONS = {
  accept: 'accept',
  decline: 'decline',
} as const;

// ---------------------------------------------------------------------------
// Command spec parsing / probing
// ---------------------------------------------------------------------------

export interface CommandSpec {
  command: string;
  args: string[];
}

/**
 * Split a command string (`codex app-server`, `node C:\mock server.mjs`,
 * `"C:\Program Files\bin\app.exe" --stdio`) into bin + args. Supports double
 * and single quoted segments; backslashes are treated literally (Windows
 * friendly).
 */
export function parseCommandSpec(command: string): CommandSpec {
  const trimmed = command.trim();
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  const [bin, ...args] = parts;
  if (!bin) throw new Error(`Empty codex app-server command: ${JSON.stringify(command)}`);
  return { command: bin, args };
}

/** Probe an executable's existence without throwing. */
async function probeExitCode(spawnFn: SpawnFn, command: string, args: string[]): Promise<number | null> {
  return await new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(command, args, { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code ?? null));
    // Safety net so a hung probe cannot dangle forever.
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      resolve(null);
    }, 5000);
    child.once('close', () => clearTimeout(timer));
    child.once('error', () => clearTimeout(timer));
  });
}

/**
 * True when the resolved command's binary is executable. Uses `where` on
 * Windows and `command -v` elsewhere for bare names, and a filesystem check
 * for path-qualified binaries. Never throws.
 */
export async function isCommandAvailable(spec: CommandSpec, spawnFn: SpawnFn): Promise<boolean> {
  const bin = spec.command;
  try {
    const pathLike = bin.includes('/') || bin.includes('\\') || isAbsolute(bin);
    if (pathLike) return existsSync(bin);
    if (process.platform === 'win32') {
      const code = await probeExitCode(spawnFn, 'where', [bin]);
      return code === 0;
    }
    const shell = process.env['SHELL'] ?? '/bin/sh';
    const code = await probeExitCode(spawnFn, shell, ['-c', `command -v ${JSON.stringify(bin)}`]);
    return code === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wire payload types (verified shapes; decode defensively)
// ---------------------------------------------------------------------------

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RpcId = string | number;

export interface InitializeParams {
  clientInfo: { name: string; title?: string; version?: string };
  /**
   * Client capabilities. `experimentalApi: true` is required for
   * `thread/resume.excludeTurns` (verified against codex-cli 0.131.0: without
   * the capability the server rejects the resume with
   * "excludeTurns requires experimentalApi capability").
   */
  capabilities?: { experimentalApi?: boolean };
}

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  /**
   * Sandbox posture. The default (workspace-write) executes workspace writes
   * with NO approval request, silently bypassing AgentMesa's permission fence
   * (verified live against codex-cli 0.152.0). `read-only` forces every write
   * through a requestApproval round-trip.
   */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface ThreadResumeParams {
  threadId: string;
  excludeTurns?: boolean;
}

export interface TurnStartParams {
  threadId: string;
  input: Array<{ type: 'text'; text: string }>;
  cwd?: string;
  /**
   * Turn-level approval posture. `thread/resume` carries no effective
   * approvalPolicy (accepted but not echoed/persisted — verified against
   * codex-cli 0.131.0), so the turn level is the only reliable place to lift
   * a resumed external session onto on-request approval.
   */
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  /**
   * Turn-level sandbox posture — same semantics as
   * {@link ThreadStartParams.sandbox}; the turn level covers resumed threads
   * whose stored posture cannot be lifted any other way.
   */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface CodexThread {
  id: string;
  [key: string]: unknown;
}

export interface CodexTurnError {
  message?: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status?: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  items?: CodexThreadItem[];
  error?: CodexTurnError | null;
  [key: string]: unknown;
}

export interface CodexThreadItem {
  id: string;
  type?: string;
  text?: string;
  summary?: string;
  content?: unknown;
  command?: string;
  cwd?: string;
  status?: string;
  changes?: Array<{ path?: string; kind?: string; diff?: string }>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  [key: string]: unknown;
}

export interface AgentMessageDeltaParams {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  delta?: string;
}

export interface ReasoningSummaryTextDeltaParams extends AgentMessageDeltaParams {
  summaryIndex?: number;
}

export interface ItemLifecycleParams {
  item?: CodexThreadItem;
  threadId?: string;
  turnId?: string;
}

export interface TurnLifecycleParams {
  threadId?: string;
  turn?: CodexTurn;
}

export interface ErrorNotificationParams {
  error?: { message?: string };
  willRetry?: boolean;
  threadId?: string;
  turnId?: string;
}

export interface CommandApprovalParams {
  kind?: 'command' | 'writeStdin';
  threadId?: string;
  turnId?: string;
  itemId?: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown;
  [key: string]: unknown;
}

export interface FileChangeApprovalParams {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
  grantRoot?: string | null;
  [key: string]: unknown;
}

export interface PermissionsApprovalParams {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  environmentId?: string | null;
  cwd?: string | null;
  reason?: string | null;
  permissions?: unknown;
  [key: string]: unknown;
}

export interface ApprovalDecisionResponse {
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
}

export interface PermissionsGrantResponse {
  scope?: 'turn' | 'session';
  permissions: unknown;
}

// ---------------------------------------------------------------------------
// JSON-RPC connection over stdio
// ---------------------------------------------------------------------------

export interface JsonRpcConnectionHooks {
  onNotification: (method: string, params: unknown) => void;
  onServerRequest: (id: RpcId, method: string, params: unknown) => void;
  onFatal: (error: Error) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages one `codex app-server` child process: id allocation, a pending
 * request map, JSONL frame read/write over stdio, and notification /
 * server-request dispatch. Unprompted process death or stdout EOF rejects all
 * pending requests and fires `onFatal` exactly once — no dangling promises.
 */
export class JsonRpcConnection {
  private readonly child: ChildProcess;
  /** True when spawned through a cmd.exe shim (bare .cmd names on Windows). */
  private spawnedViaShell = false;
  /** Hook object is shared by reference: the driver rebinds its fields once the session exists. */
  private readonly hooks: JsonRpcConnectionHooks;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private fatalFired = false;
  private exitWaiters: Array<() => void> = [];

  constructor(
    spec: CommandSpec,
    private readonly spawnFn: SpawnFn,
    hooks: JsonRpcConnectionHooks,
    options: { cwd?: string; requestTimeoutMs?: number } = {}
  ) {
    this.hooks = hooks;
    // On Windows a bare binary name may resolve to a .cmd shim which node
    // refuses to spawn without a shell; route bare names through cmd when the
    // binary is not a direct .exe path.
    const useShell =
      process.platform === 'win32' && !/\.(exe|com)$/i.test(spec.command) && !spec.command.includes('\\');
    const command = useShell
      ? [spec.command, ...spec.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
      : spec.command;
    const args = useShell ? [] : spec.args;
    this.child = this.spawnFn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      ...(useShell ? { shell: true } : {}),
    });
    // Remember the shell-shim path: killing must then take the whole process
    // tree, or the real server process (a grandchild of cmd.exe) is orphaned.
    this.spawnedViaShell = useShell;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;

    this.child.once('error', (err) => this.handleFatal(new Error(`codex app-server spawn failed: ${err.message}`)));
    this.child.once('exit', () => {
      // Exit before close(): treat as crash unless we are closing gracefully.
      if (!this.closed) {
        this.handleFatal(new Error('codex app-server process exited unexpectedly'));
      }
      this.resolveExitWaiters();
    });
    this.child.once('close', () => this.resolveExitWaiters());

    const stdout = this.child.stdout;
    if (stdout) {
      const rl = createInterface({ input: stdout });
      rl.on('line', (line) => this.handleLine(line));
      rl.on('close', () => {
        if (!this.closed) {
          this.handleFatal(new Error('codex app-server stdout closed unexpectedly'));
        }
      });
    } else {
      this.handleFatal(new Error('codex app-server child has no stdout pipe'));
    }
    if (this.child.stdin) {
      this.child.stdin.on('error', () => {
        /* EPIPE racing shutdown — fatal path handled by exit/close. */
      });
    }
  }

  private readonly requestTimeoutMs: number;

  get pid(): number | undefined {
    return this.child.pid;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed || this.fatalFired) {
      return Promise.reject(new Error('codex app-server connection is closed'));
    }
    const id = this.nextId++;
    const message = params === undefined ? { method, id } : { method, id, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write(message);
    });
  }

  notify(method: string, params?: unknown): void {
    const message = params === undefined ? { method } : { method, params };
    this.write(message);
  }

  /** Answer a server-initiated request by echoing its id. */
  respondServerRequest(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  /** Answer a server-initiated request with a JSON-RPC error. */
  respondServerError(id: RpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  /**
   * Graceful shutdown: end stdin (app-server exits on EOF), wait briefly,
   * then escalate SIGTERM/SIGKILL. Safe to call more than once.
   */
  async close(graceMs = 1500): Promise<void> {
    if (this.closed) {
      await this.waitForExit(1000);
      return;
    }
    this.closed = true;
    const stdin = this.child.stdin;
    if (stdin && !stdin.destroyed) {
      try {
        stdin.end();
      } catch {
        // Already torn down.
      }
    }
    const exited = await this.waitForExit(graceMs);
    if (!exited) {
      this.killChild();
      const termOk = await this.waitForExit(2000);
      if (!termOk) {
        this.killChild();
        await this.waitForExit(2000);
      }
    }
    this.failPending(new Error('codex app-server connection closed'));
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve(true);
        return;
      }
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.exitWaiters.push(() => done(true));
    });
  }

  private resolveExitWaiters(): void {
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private write(message: unknown): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || this.fatalFired) {
      return;
    }
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON noise on stdout (e.g. logging) — ignore.
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const msg = parsed as Record<string, unknown>;
    if ('id' in msg && msg['id'] !== undefined && 'method' in msg && typeof msg['method'] === 'string') {
      // Server-initiated request.
      this.hooks.onServerRequest(msg['id'] as RpcId, msg['method'], msg['params']);
      return;
    }
    if ('id' in msg && msg['id'] !== undefined) {
      // Response to one of our requests.
      const id = typeof msg['id'] === 'number' ? msg['id'] : Number(msg['id']);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if ('error' in msg && msg['error'] !== null) {
        const err = msg['error'] as JsonRpcError;
        pending.reject(
          new Error(`codex app-server error ${err.code ?? ''}: ${err.message ?? 'unknown error'}`.trim())
        );
      } else {
        pending.resolve(msg['result']);
      }
      return;
    }
    if ('method' in msg && typeof msg['method'] === 'string') {
      this.hooks.onNotification(msg['method'], msg['params']);
    }
  }

  private handleFatal(error: Error): void {
    if (this.fatalFired) return;
    this.fatalFired = true;
    this.failPending(error);
    if (!this.closed) {
      this.killChild();
    }
    this.hooks.onFatal(error);
  }

  /**
   * Kill the spawned child. Under the Windows shell-shim path the direct
   * child is cmd.exe wrapping the real server process; a plain kill() would
   * orphan the grandchild — a stray `codex app-server` keeps competing for
   * ~/.codex locks (models cache, sessions dir) and leaves every later spawn
   * wedgier (observed live: repeated `thread/start` timeouts). `taskkill /T`
   * takes down the whole tree.
   */
  private killChild(): void {
    try {
      if (process.platform === 'win32' && this.spawnedViaShell && this.child.pid) {
        spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        this.child.kill('SIGTERM');
      }
    } catch {
      // Already gone.
    }
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
