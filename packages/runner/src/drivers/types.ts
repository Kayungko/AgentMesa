/**
 * M4 Deep Orchestration — agent driver contract.
 *
 * A driver wraps a *persistent, stateful agent session* (Claude Agent SDK,
 * Codex app-server) as opposed to the one-shot CLI runners in `../runners/`.
 * Deep drivers let AgentMesa drive full agent sessions — multi-turn threads,
 * permission gates, interruption, and resume across processes.
 *
 * Implementation notes:
 * - Drivers MUST be transport-agnostic about Mesa: they talk events and
 *   permission callbacks only. Policy enforcement (assertPolicy) and approval
 *   gates are wired by the caller (run-executor), never inside a driver.
 * - A driver must never require its backing binary/SDK at import time.
 *   `isAvailable()` is the availability probe; the factory falls back to the
 *   CLI runners when it returns false.
 */

/** Which deep-driver backend this session runs on. */
export type DriverKind = 'claude-agent-sdk' | 'codex-app-server';

/** Input for one turn sent into an existing driver session. */
export interface DriverTurnInput {
  /** The prompt for this turn. */
  prompt: string;
  /** Optional wall-clock cap for the whole turn, in milliseconds. */
  timeoutMs?: number;
}

/**
 * A permission/approval request surfaced by the underlying agent (tool call
 * gate, command approval, patch approval...). Mesa decides via policy engine
 * or human approval gate and answers with `respondPermission`.
 */
export interface DriverPermissionRequest {
  /** Driver-scoped id used to answer via `respondPermission`. */
  requestId: string;
  /** What is being gated: tool name, shell command, or file patch. */
  kind: 'tool' | 'command' | 'patch';
  /** Human-readable description, e.g. `bash: rm -rf build/`. */
  title: string;
  /** Raw payload for policy evaluation (tool input, command line, diff...). */
  detail: unknown;
}

/** Events streamed out of one turn. Order is not guaranteed across kinds. */
export type DriverEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_use';
      tool: string;
      input: unknown;
    }
  | { type: 'permission_request'; request: DriverPermissionRequest }
  | {
      type: 'turn_complete';
      success: boolean;
      /** Final assistant answer or error summary for the turn. */
      summary: string;
    }
  | { type: 'error'; message: string; fatal?: boolean };

/** Serializable handle persisted with the Mesa agent-run so a session can be resumed in a later process. */
export interface DriverSessionHandle {
  kind: DriverKind;
  /** Backend-native session/conversation id (SDK session id, app-server conversation id). */
  backendSessionId: string;
  /** ISO timestamp of handle creation. */
  createdAt: string;
  /**
   * True when the handle was seeded by `adoptExternalDriverSession` (external
   * takeover) rather than grown organically from a Mesa-driven turn. Adopted
   * handles activate strict resume semantics: a resume failure must fail loud
   * instead of silently cold-starting a new conversation.
   */
  adopted?: boolean;
}

/** Options when creating or resuming a driver session. */
export interface DriverSessionInit {
  /** Working directory the agent operates in (the Mesa workspace root). */
  cwd: string;
  /** Free-form system/developer preamble appended by Mesa (task context, collaboration rules). */
  systemPrompt?: string;
  /**
   * When true the driver should run with auto-approval disabled — every
   * gated action surfaces as a `permission_request` event. When false the
   * driver may let the backend's own permission mode decide. Mesa-side policy
   * is still the final gate either way (see `respondPermission`).
   */
  requirePermissions?: boolean;
}

/** A live, resumable agent session backed by a deep driver. */
export interface AgentDriverSession {
  readonly kind: DriverKind;
  readonly backendSessionId: string;

  /**
   * Run one turn. The async iterable yields events as they arrive; it ends
   * after the `turn_complete` (or fatal `error`) event. While the iterable is
   * being consumed, pending `permission_request`s must be answered through
   * `respondPermission` or the turn will stall.
   */
  send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent>;

  /** Answer a surfaced permission request. Unanswered requests stall the turn. */
  respondPermission(
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string
  ): Promise<void>;

  /** Best-effort interrupt of the in-flight turn (drives the iterable to a terminal event). */
  interrupt(): Promise<void>;

  /** Serializable handle for persisting + later `AgentDriver.resumeSession`. */
  handle(): DriverSessionHandle;

  /** Terminate the session and release child process / SDK resources. */
  close(): Promise<void>;
}

/** Deep driver factory. One instance per backend; safe to share. */
export interface AgentDriver {
  readonly kind: DriverKind;
  /** Human-readable name for diagnostics, e.g. `claude-agent-sdk`. */
  readonly name: string;

  /** True when the backing SDK/binary is installed and configured. Must be cheap and side-effect free. */
  isAvailable(): Promise<boolean>;

  /** Start a new backend session. */
  createSession(init: DriverSessionInit): Promise<AgentDriverSession>;

  /** Reattach to a previously persisted session (resume threads/context). */
  resumeSession(handle: DriverSessionHandle, init: DriverSessionInit): Promise<AgentDriverSession>;
}

/** Union of config-driven driver preference. */
export type DriverPreference =
  | { kind: 'auto' }
  | { kind: DriverKind }
  | { kind: 'cli' };
