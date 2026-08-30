import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgent, MesaAgentRun } from '@agentmesa/protocol';
import type { AgentDriver, DriverKind, DriverPreference, DriverSessionHandle } from './types.js';

/**
 * M4 Deep Orchestration — driver selection, CLI fallback, and the persisted
 * driver-session handle store.
 *
 * This module is deliberately free of any concrete driver implementation: the
 * registry is injected (tests pass fakes; the app assembles real drivers in
 * `drivers/index.ts`).
 */

/** Environment variable holding the driver preference (`auto|claude-agent-sdk|codex-app-server|cli`). */
export const DRIVER_PREFERENCE_ENV = 'AGENTMESA_DRIVER';

/** Directory (under `.agentmesa/`) holding persisted driver-session handles. */
export const DRIVER_SESSIONS_DIR = 'driver-sessions';

/**
 * Parse a raw preference string. Unknown or empty values resolve to `auto`
 * (never crash the executor over a bad env value).
 */
export function parseDriverPreference(value: string | undefined | null): DriverPreference {
  const normalized = value?.trim();
  if (!normalized) {
    return { kind: 'auto' };
  }
  if (normalized === 'cli') {
    return { kind: 'cli' };
  }
  if (normalized === 'claude-agent-sdk' || normalized === 'codex-app-server') {
    return { kind: normalized };
  }
  return { kind: 'auto' };
}

/**
 * Resolve the effective preference: an explicit argument wins; otherwise the
 * `AGENTMESA_DRIVER` env var; otherwise `auto`.
 */
export function resolveDriverPreference(
  explicit?: string | DriverPreference,
): DriverPreference {
  if (explicit === undefined) {
    return parseDriverPreference(process.env[DRIVER_PREFERENCE_ENV]);
  }
  if (typeof explicit === 'string') {
    return parseDriverPreference(explicit);
  }
  return explicit;
}

/** Map an agent registry `client` field onto the deep driver kind it implies. */
export function clientToDriverKind(client: string | undefined): DriverKind | undefined {
  if (!client) {
    return undefined;
  }
  // The registry uses both 'claude' and 'claude-code' for Claude-backed agents.
  if (client.startsWith('claude')) {
    return 'claude-agent-sdk';
  }
  if (client.startsWith('codex')) {
    return 'codex-app-server';
  }
  return undefined;
}

export interface DriverTransportResolution {
  /** 'driver' = run the turn on a deep driver session; 'cli' = legacy one-shot runner. */
  transport: 'driver' | 'cli';
  /** The selected driver (only when transport is 'driver'). */
  driver?: AgentDriver;
  /** The driver kind that was targeted, for diagnostics. */
  kind?: DriverKind;
  /** Why the executor fell back to the CLI path. Present iff transport is 'cli' and a driver was considered. */
  fallbackReason?: string;
}

/**
 * Decide whether a run should execute on a deep driver or the CLI runners.
 *
 * Rules:
 * - preference `cli` → always the CLI path.
 * - preference `auto` → map the agent's `client` field ('claude*' →
 *   claude-agent-sdk, 'codex*' → codex-app-server); no mapping, missing driver,
 *   or unavailable driver → CLI fallback with a reason.
 * - preference `<kind>` → use that driver when registered and available;
 *   otherwise CLI fallback with a reason.
 * - empty registry → CLI fallback.
 */
export async function resolveDriverTransport(
  preference: DriverPreference,
  agent: MesaAgent | undefined,
  registry: readonly AgentDriver[],
): Promise<DriverTransportResolution> {
  if (preference.kind === 'cli') {
    return { transport: 'cli', fallbackReason: 'driver preference set to cli' };
  }
  if (registry.length === 0) {
    return { transport: 'cli', fallbackReason: 'no deep drivers registered' };
  }

  let targetKind: DriverKind;
  if (preference.kind === 'auto') {
    const mapped = clientToDriverKind(agent?.client);
    if (!mapped) {
      return {
        transport: 'cli',
        fallbackReason: `no driver mapping for agent client "${agent?.client ?? 'unknown'}"`,
      };
    }
    targetKind = mapped;
  } else {
    targetKind = preference.kind;
  }

  const driver = registry.find((candidate) => candidate.kind === targetKind);
  if (!driver) {
    return {
      transport: 'cli',
      kind: targetKind,
      fallbackReason: `driver "${targetKind}" not registered`,
    };
  }

  let available = false;
  try {
    available = await driver.isAvailable();
  } catch {
    // A probing failure is treated as unavailability, never as a crash.
    available = false;
  }
  if (!available) {
    return {
      transport: 'cli',
      kind: targetKind,
      fallbackReason: `driver "${driver.name}" unavailable`,
    };
  }

  return { transport: 'driver', driver, kind: targetKind };
}

// ---------------------------------------------------------------------------
// Persisted driver-session handles
// ---------------------------------------------------------------------------

interface StoredDriverSession {
  handle: DriverSessionHandle;
  lastRunId?: string;
  updatedAt: string;
}

interface DriverSessionRecord {
  agentId: string;
  /** scope key (meetingId / taskId / '_global') → latest session for that scope. */
  sessions: Record<string, StoredDriverSession>;
}

/** Scope key under which a run's session handle is stored (per agent). */
export function driverSessionScope(run: Pick<MesaAgentRun, 'meetingId' | 'taskId'>): string {
  return run.meetingId ?? run.taskId ?? '_global';
}

/** Filesystem-safe name for an agent's handle record. */
function handleFileName(agentId: string): string {
  const safe = agentId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe.length > 0 ? safe : 'agent'}.json`;
}

function handleFilePath(ctx: MesaRuntimeContext, agentId: string): string {
  return join(ctx.paths.mesaDir, DRIVER_SESSIONS_DIR, handleFileName(agentId));
}

/**
 * Read the latest persisted handle for `agentId` in the given scope.
 * Missing files, corrupted JSON, and malformed entries all resolve to
 * `undefined` (the caller then starts a fresh session).
 */
export function loadDriverSessionHandle(
  ctx: MesaRuntimeContext,
  agentId: string,
  scope: string,
): DriverSessionHandle | undefined {
  let raw: string;
  try {
    raw = readFileSync(handleFilePath(ctx, agentId), 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const record = JSON.parse(raw) as DriverSessionRecord;
    const entry = record?.sessions?.[scope];
    const handle = entry?.handle;
    if (
      !handle ||
      (handle.kind !== 'claude-agent-sdk' && handle.kind !== 'codex-app-server') ||
      typeof handle.backendSessionId !== 'string' ||
      handle.backendSessionId.length === 0
    ) {
      return undefined;
    }
    return handle;
  } catch {
    return undefined;
  }
}

/**
 * Persist a session handle for `agentId` under `scope` (atomic temp+rename
 * write). Overwrites the previous handle for that scope only.
 */
export function saveDriverSessionHandle(
  ctx: MesaRuntimeContext,
  agentId: string,
  scope: string,
  handle: DriverSessionHandle,
  lastRunId?: string,
): void {
  const file = handleFilePath(ctx, agentId);
  mkdirSync(join(ctx.paths.mesaDir, DRIVER_SESSIONS_DIR), { recursive: true });

  let record: DriverSessionRecord = { agentId, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as DriverSessionRecord;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.sessions) {
      record = { agentId, sessions: parsed.sessions };
    }
  } catch {
    // Fresh (or corrupted) file — start a new record.
  }

  record.sessions[scope] = {
    handle,
    ...(lastRunId !== undefined ? { lastRunId } : {}),
    updatedAt: new Date().toISOString(),
  };

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  renameSync(tmp, file);
}
