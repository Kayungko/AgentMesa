import {
  MesaError,
  appendAgentRunProgress,
  getAgent,
  getAgentRun,
  updateAgentRunStatus,
  createArtifact,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgentRun, RunProgress } from '@agentmesa/protocol';
import type { RunProgressSink, RunResult, RunnerType } from './types.js';
import type {
  AgentDriver,
  AgentDriverSession,
  DriverEvent,
  DriverPermissionRequest,
  DriverPreference,
  DriverSessionHandle,
  DriverSessionInit,
} from './drivers/types.js';
import {
  driverSessionScope,
  loadDriverSessionHandle,
  resolveDriverPreference,
  resolveDriverTransport,
  saveDriverSessionHandle,
} from './drivers/resolve.js';
import { createRunner } from './runner-factory.js';
import { parseRunOutput } from './output-parser.js';

const RUNNER_TYPES: readonly RunnerType[] = [
  'claude-implement',
  'claude-fix',
  'codex-review',
  'codex-test',
  'shell-check',
  'document',
  'session',
];

export function isRunnerType(value: string | undefined): value is RunnerType {
  return value !== undefined && (RUNNER_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve which runner backend should execute a run. An explicit `runnerType`
 * on the run wins; otherwise the run `action` is mapped to a default backend.
 */
export function resolveRunnerType(run: MesaAgentRun): RunnerType {
  if (isRunnerType(run.runnerType)) {
    return run.runnerType;
  }
  switch (run.action) {
    case 'fix':
      return 'claude-fix';
    case 'review':
      return 'codex-review';
    case 'test':
      return 'codex-test';
    case 'document':
      return 'document';
    case 'implement':
    case 'plan':
    case 'custom':
    default:
      return 'claude-implement';
  }
}

/**
 * Permission gate for deep-driver turns. The default implementation denies
 * everything; the real policy engine / human approval bridge is injected here
 * by the caller (CLI/desk — see docs/DRIVERS.md § Permission bridging).
 */
export type DriverPermissionResponder = (
  request: DriverPermissionRequest,
) => Promise<'allow' | 'deny'>;

const denyAllPermissions: DriverPermissionResponder = async () => 'deny';

export interface RunExecutorOptions {
  dryRun?: boolean;
  /** Persist run output as an artifact. Default true; always skipped on dry run. */
  createArtifacts?: boolean;
  timeout?: number;
  onProgress?: RunProgressSink;
  /**
   * M4 deep-driver registry (dependency-injected; tests pass fakes, the app
   * assembles real drivers in `drivers/index.ts`). Empty or omitted keeps the
   * legacy CLI path byte-for-byte.
   */
  driverRegistry?: readonly AgentDriver[];
  /**
   * Deep-driver preference: 'auto' | 'claude-agent-sdk' | 'codex-app-server' |
   * 'cli'. Falls back to the `AGENTMESA_DRIVER` env var, then 'auto'.
   */
  driverPreference?: DriverPreference | string;
  /** Permission gate for deep-driver turns. Default: deny all. */
  permissionResponder?: DriverPermissionResponder;
  /**
   * Resume semantics for the deep-driver path when a persisted session handle
   * exists:
   * - `fallback` (default): legacy behavior — resume failures warn and fall
   *   back to a fresh session; kind mismatches silently skip resume.
   * - `strict`: fail-loud (used for externally adopted sessions, where a
   *   handle that cannot resume must surface instead of silently starting a
   *   new conversation).
   */
  resumeMode?: 'fallback' | 'strict';
}

export interface RunExecutionResult {
  /** Final persisted run (completed | failed). */
  run: MesaAgentRun;
  /** Raw result from the runner backend. */
  result: RunResult;
}

/**
 * Drive an existing `pending` agent run through its lifecycle:
 * pending → running → completed | failed. Captures output and, on a
 * successful non-dry run, persists it as an `agent_run_log` artifact.
 *
 * When a non-empty `driverRegistry` is injected and the resolved driver
 * transport is available, the run executes as one deep-driver turn instead of
 * a one-shot CLI invocation (session resume via the persisted handle). Every
 * other combination — preference `cli`, driver unavailable, empty registry,
 * dry runs — takes the unchanged CLI path.
 */
export async function executeRun(
  ctx: MesaRuntimeContext,
  runId: string,
  options?: RunExecutorOptions,
): Promise<RunExecutionResult> {
  const dryRun = options?.dryRun ?? false;
  const createArtifacts = options?.createArtifacts ?? true;

  const run = getAgentRun(ctx, runId);
  if (run.status !== 'pending') {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Run ${runId} is not pending (status: ${run.status}); only pending runs can be executed`,
    );
  }

  const runnerType = resolveRunnerType(run);
  updateAgentRunStatus(ctx, runId, 'running');

  const reportProgress = async (progress: RunProgress): Promise<void> => {
    appendAgentRunProgress(ctx, runId, progress);
    try {
      await options?.onProgress?.(progress);
    } catch (error) {
      ctx.logger.warn('Run progress sink failed', {
        runId,
        stage: progress.stage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await reportProgress({ stage: 'started', message: 'Run started', percent: 0 });
  const runner = createRunner(runnerType, ctx.paths, dryRun);

  const driverRegistry = options?.driverRegistry ?? [];
  const driverResolution =
    !dryRun && driverRegistry.length > 0
      ? await resolveDriverTransport(
          resolveDriverPreference(options?.driverPreference),
          safeGetAgent(ctx, run.agentId),
          driverRegistry,
        )
      : undefined;

  let result: RunResult;
  try {
    const selectedDriver =
      driverResolution?.transport === 'driver' ? driverResolution.driver : undefined;
    if (selectedDriver) {
      await reportProgress({
        stage: 'driver_session',
        message: `Executing deep-driver turn via ${selectedDriver.name}`,
        percent: 10,
      });
      const outcome = await executeDriverTurn(ctx, {
        run,
        driver: selectedDriver,
        runnerType,
        timeoutMs: options?.timeout,
        permissionResponder: options?.permissionResponder,
        resumeMode: options?.resumeMode,
        onProgress: reportProgress,
      });
      result = outcome.result;
    } else {
      if (driverResolution?.fallbackReason) {
        ctx.logger.warn('Deep driver unavailable; falling back to CLI runner', {
          runId,
          reason: driverResolution.fallbackReason,
        });
      }
      await reportProgress({ stage: 'runner_invoked', message: `Invoking ${runnerType}`, percent: 10 });
      result = await runner.run({
        taskId: run.taskId ?? '',
        runnerType,
        agentId: run.agentId,
        dryRun,
        ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
        extraPrompt: run.input,
        onProgress: reportProgress,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reportProgress({ stage: 'failed', message, percent: 100 });
    updateAgentRunStatus(ctx, runId, 'failed', { error: message });
    throw err;
  }

  if (!result.success) {
    const parsed = parseRunOutput(result.output);
    await reportProgress({ stage: 'failed', message: parsed.summary, percent: 100 });
    const failed = updateAgentRunStatus(ctx, runId, 'failed', {
      error: result.output,
      outputSummary: parsed.summary,
    });
    return { run: failed, result };
  }

  const producedArtifactIds: string[] = [];
  if (createArtifacts && !dryRun) {
    await reportProgress({ stage: 'persisting_artifact', message: 'Persisting run artifact', percent: 90 });
    const artifact = createArtifact(ctx, {
      kind: 'agent_run_log',
      taskId: run.taskId,
      producedByAgentId: run.agentId,
      content: result.output,
      mimeType: 'text/markdown',
    });
    producedArtifactIds.push(artifact.id);
  }

  const parsed = parseRunOutput(result.output);
  await reportProgress({ stage: 'completed', message: parsed.summary, percent: 100 });
  const completed = updateAgentRunStatus(ctx, runId, 'completed', {
    output: result.output,
    outputSummary: parsed.summary,
    ...(producedArtifactIds.length > 0 ? { producedArtifactIds } : {}),
  });

  return { run: completed, result };
}

function safeGetAgent(ctx: MesaRuntimeContext, agentId: string) {
  try {
    return getAgent(ctx, agentId);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Deep-driver turn execution (M4)
// ---------------------------------------------------------------------------

/** Outcome of one deep-driver turn. */
export interface DriverTurnOutcome {
  /** RunResult-shaped outcome for the standard run state machine. */
  result: RunResult;
  /** Persisted session handle (present unless the driver failed to produce one). */
  handle: DriverSessionHandle | undefined;
  /** True when an existing session was resumed instead of created. */
  resumed: boolean;
}

/** Raised internally when a driver turn exceeds its wall-clock budget. */
class DriverTurnTimeout extends Error {}

const PROGRESS_MESSAGE_LIMIT = 200;

function truncateForProgress(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PROGRESS_MESSAGE_LIMIT
    ? `${oneLine.slice(0, PROGRESS_MESSAGE_LIMIT)}…`
    : oneLine;
}

function summarizeToolInput(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'string') {
    return truncateForProgress(input);
  }
  try {
    return truncateForProgress(JSON.stringify(input));
  } catch {
    return '';
  }
}

function driverSessionInit(ctx: MesaRuntimeContext): DriverSessionInit {
  return { cwd: ctx.paths.rootDir, requirePermissions: true };
}

function raceNextEvent(
  iterator: AsyncIterableIterator<DriverEvent>,
  budgetMs: number,
): Promise<IteratorResult<DriverEvent>> {
  return Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new DriverTurnTimeout(`driver turn exceeded ${budgetMs}ms`)),
        budgetMs,
      );
      timer.unref?.();
    }),
  ]);
}

export interface DriverTurnParams {
  /** The agent run whose `input` is the turn prompt (used for scope + identity). */
  run: MesaAgentRun;
  /** The resolved deep driver. */
  driver: AgentDriver;
  /** RunnerType stamped onto the returned RunResult. */
  runnerType: RunnerType;
  /** Override the turn prompt (defaults to `run.input`). */
  prompt?: string;
  /** Wall-clock cap for the whole turn, in milliseconds. */
  timeoutMs?: number;
  /** Permission gate; default denies everything. */
  permissionResponder?: DriverPermissionResponder;
  /**
   * Resume semantics for a persisted session handle:
   * - `fallback` (default): legacy behavior — resume failures warn and fall
   *   back to `createSession`; a handle/driver kind mismatch silently skips
   *   resume.
   * - `strict`: fail-loud — a kind mismatch or a resume failure rejects the
   *   turn (the run layer then records it as failed). Strict only constrains
   *   the "a handle exists but cannot be resumed" case; with *no* persisted
   *   handle it behaves exactly like fallback and creates a fresh session.
   */
  resumeMode?: 'fallback' | 'strict';
  /** Progress sink (failures are swallowed — progress must not kill a turn). */
  onProgress?: RunProgressSink;
}

/**
 * Execute one turn on a deep-driver session: resume the persisted handle for
 * this agent+scope when possible (otherwise create a session), stream
 * DriverEvents into RunProgress, bridge permission requests through the
 * injected responder, persist the resulting handle, and close the session.
 *
 * Exported so the CLI / desk can drive deep-driver turns directly, outside the
 * agent-run state machine.
 */
export async function executeDriverTurn(
  ctx: MesaRuntimeContext,
  params: DriverTurnParams,
): Promise<DriverTurnOutcome> {
  const { run, driver, runnerType } = params;
  const prompt = params.prompt ?? run.input;
  const respondPermission = params.permissionResponder ?? denyAllPermissions;
  const timeoutMs = params.timeoutMs;
  // After an interrupt the driver should emit a terminal event promptly; this
  // grace budget bounds how long we keep draining before giving up on it.
  const graceMs = Math.max(100, Math.min(timeoutMs ?? 30_000, 5_000));
  const startTime = Date.now();
  const scope = driverSessionScope(run);

  const resumeMode = params.resumeMode ?? 'fallback';
  const savedHandle = loadDriverSessionHandle(ctx, run.agentId, scope);
  let session: AgentDriverSession | undefined;
  let resumed = false;
  if (savedHandle && savedHandle.kind !== driver.kind) {
    if (resumeMode === 'strict') {
      // Takeover semantics: the handle was (typically) seeded externally for a
      // specific backend. A kind mismatch means the driver configuration has
      // drifted — surface it instead of silently starting a new session.
      throw new MesaError(
        'VALIDATION_ERROR',
        `strict resume failed for agent "${run.agentId}" (scope "${scope}"): saved session handle kind ` +
          `"${savedHandle.kind}" does not match driver kind "${driver.kind}"`,
      );
    }
    // fallback: kind mismatch silently skips resume (legacy behavior).
  }
  if (savedHandle && savedHandle.kind === driver.kind) {
    try {
      session = await driver.resumeSession(savedHandle, driverSessionInit(ctx));
      resumed = true;
    } catch (error) {
      if (resumeMode === 'strict') {
        // Propagate the failure (never fall back to a fresh session) while
        // attaching enough context to diagnose the takeover.
        throw new MesaError(
          'VALIDATION_ERROR',
          `strict resume failed for agent "${run.agentId}" (scope "${scope}", handle kind ` +
            `"${savedHandle.kind}", backend session "${savedHandle.backendSessionId}"): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      ctx.logger.warn('Deep driver resume failed; creating a new session', {
        agentId: run.agentId,
        driver: driver.name,
        error: error instanceof Error ? error.message : String(error),
      });
      session = undefined;
    }
  }
  if (!session) {
    // Reached both when no handle was persisted at all (strict and fallback
    // alike — strict only governs the "handle exists but cannot resume" case)
    // and on a fallback-mode resume failure.
    session = await driver.createSession(driverSessionInit(ctx));
  }
  const activeSession: AgentDriverSession = session;

  const emit = async (stage: string, message: string): Promise<void> => {
    if (message.length === 0) {
      return;
    }
    try {
      await params.onProgress?.({ stage, message });
    } catch {
      // Progress sink failures must never fail the turn.
    }
  };

  const textChunks: string[] = [];
  let turnSuccess = false;
  let turnSummary = '';
  let fatalError: string | undefined;
  let timedOut = false;
  let handle: DriverSessionHandle | undefined;

  try {
    const iterator = activeSession.send({
      prompt,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    try {
      for (;;) {
        const next =
          timeoutMs === undefined
            ? await iterator.next()
            : await raceNextEvent(
                iterator,
                timedOut ? graceMs : Math.max(0, timeoutMs - (Date.now() - startTime)),
              );
        if (next.done) {
          break;
        }
        const event = next.value;
        if (event.type === 'text') {
          textChunks.push(event.text);
          await emit('agent_message', truncateForProgress(event.text));
          continue;
        }
        if (event.type === 'thinking') {
          await emit('agent_thinking', truncateForProgress(event.text));
          continue;
        }
        if (event.type === 'tool_use') {
          const inputSummary = summarizeToolInput(event.input);
          await emit('tool_use', inputSummary ? `${event.tool}: ${inputSummary}` : event.tool);
          continue;
        }
        if (event.type === 'permission_request') {
          await emit('permission_request', truncateForProgress(event.request.title));
          const decision = await respondPermission(event.request);
          await emit(
            decision === 'allow' ? 'permission_granted' : 'permission_denied',
            truncateForProgress(event.request.title),
          );
          await activeSession.respondPermission(
            event.request.requestId,
            decision,
            decision === 'allow' ? undefined : 'Denied by AgentMesa policy',
          );
          continue;
        }
        if (event.type === 'error') {
          if (event.fatal) {
            fatalError = event.message;
            break;
          }
          await emit('driver_error', truncateForProgress(event.message));
          continue;
        }
        // turn_complete
        turnSuccess = event.success;
        turnSummary = event.summary;
        break;
      }
    } catch (error) {
      if (error instanceof DriverTurnTimeout && !timedOut) {
        timedOut = true;
        try {
          await activeSession.interrupt();
        } catch {
          // Best effort — the grace drain below bounds the wait.
        }
        // Keep draining so a compliant driver can still flush a terminal event.
        try {
          for (;;) {
            const next = await raceNextEvent(iterator, graceMs);
            if (next.done) {
              break;
            }
            const event = next.value;
            if (event.type === 'turn_complete') {
              turnSuccess = event.success;
              turnSummary = event.summary;
              break;
            }
            if (event.type === 'error' && event.fatal) {
              fatalError = event.message;
              break;
            }
          }
        } catch {
          // Grace expired or the driver died — timedOut already records the failure.
        }
      } else {
        throw error;
      }
    }
  } finally {
    try {
      handle = activeSession.handle();
      // Takeover guard: a FAILED turn must not clobber an existing handle.
      // Backends report session ids lazily — e.g. the Claude CLI assigns a
      // fresh session id before rejecting an invalid `--resume` id — so the
      // handle observed after a failed turn can point at a session that was
      // never actually used. Persisting it would silently destroy an adopted
      // external handle (the takeover degrades to a stranger session). Keep
      // the previous handle unless the turn succeeded or there was nothing
      // to preserve.
      if (!savedHandle || turnSuccess) {
        saveDriverSessionHandle(ctx, run.agentId, scope, handle, run.id);
      } else {
        handle = savedHandle;
      }
    } catch (error) {
      ctx.logger.warn('Failed to persist deep driver session handle', {
        agentId: run.agentId,
        driver: driver.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await activeSession.close();
    } catch {
      // Best-effort cleanup.
    }
  }

  const textOutput = textChunks.join('\n').trim();
  let success: boolean;
  let output: string;
  if (timedOut) {
    success = false;
    const note = `[deep driver turn interrupted: timeout after ${timeoutMs}ms]`;
    output = textOutput.length > 0 ? `${textOutput}\n\n${note}` : note;
  } else if (fatalError !== undefined) {
    success = false;
    output = textOutput.length > 0 ? `${textOutput}\n\n${fatalError}` : fatalError;
  } else if (!turnSuccess) {
    success = false;
    // The turn summary explains why the turn failed — keep it alongside any
    // partial output, since this text becomes the run's `error` field.
    output = textOutput.length > 0 ? `${textOutput}\n\n${turnSummary}` : turnSummary;
  } else {
    success = true;
    output = textOutput.length > 0 ? textOutput : turnSummary;
  }

  const result: RunResult = {
    success,
    runnerType,
    taskId: run.taskId ?? '',
    agentId: run.agentId,
    output,
    artifacts: [],
    duration: Date.now() - startTime,
    dryRun: false,
  };
  return { result, handle, resumed };
}
