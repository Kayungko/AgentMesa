/**
 * M4 Deep Orchestration — env-driven registry assembly for executeRun call sites.
 *
 * `AGENTMESA_DRIVER` is the single switch that decides whether a call site
 * (MCP server / orchestrator / CLI) hands `executeRun` a deep-driver registry
 * or keeps the legacy CLI path:
 *
 * - unset / `auto` / unknown value → the default registry (real drivers); the
 *   executor then resolves per-run by the agent's `client` and falls back to
 *   the CLI runners whenever the mapped driver is missing or unavailable —
 *   so default-on is behavior-preserving.
 * - `cli` → empty registry, explicitly disabling deep drivers.
 * - `claude-agent-sdk` / `codex-app-server` → the default registry; the
 *   executor picks that specific driver via the same env var
 *   (`resolveDriverPreference`), so call sites never hardcode a preference.
 *
 * Each call returns FRESH driver instances (see `createDefaultDriverRegistry`)
 * — never share one array across executors.
 */

import { createDefaultDriverRegistry } from './index.js';
import {
  DRIVER_PREFERENCE_ENV,
  clientToDriverKind,
  parseDriverPreference,
} from './resolve.js';
import type { AgentDriver } from './types.js';

/** Minimal env surface the helper reads (subset of NodeJS.ProcessEnv). */
export type DriverEnvSource = Record<string, string | undefined>;

/**
 * Build the driver registry for an executeRun call site from the
 * `AGENTMESA_DRIVER` environment variable. `cli` yields an empty registry
 * (deep drivers off); everything else yields the fresh default registry.
 */
export function resolveDriverRegistryFromEnv(
  env: DriverEnvSource = process.env,
): AgentDriver[] {
  const preference = parseDriverPreference(env[DRIVER_PREFERENCE_ENV]);
  if (preference.kind === 'cli') {
    return [];
  }
  return createDefaultDriverRegistry();
}

// ---------------------------------------------------------------------------
// Session-run deep-driver switch (W1)
// ---------------------------------------------------------------------------

/** Environment variable holding the session-run driver switch (`AGENTMESA_SESSION_DRIVER`). */
export const SESSION_DRIVER_PREFERENCE_ENV = 'AGENTMESA_SESSION_DRIVER';

export type SessionDriverPreference = 'cli' | 'auto' | 'claude-agent-sdk' | 'codex-app-server';

/**
 * AGENTMESA_SESSION_DRIVER:session-run 专用驱动开关,默认 'cli'。
 *
 * The default is deliberately conservative: meeting speech (session runs) must
 * not silently change transport just because `AGENTMESA_DRIVER=auto` is set
 * for task runs. Invalid env handling mirrors `parseDriverPreference` /
 * `resolveDriverRegistryFromEnv` (unknown or empty values never crash the
 * executor — they fall back to the default, which here is `cli`).
 */
export function resolveSessionDriverPreference(
  env: DriverEnvSource = process.env,
): SessionDriverPreference {
  const normalized = env[SESSION_DRIVER_PREFERENCE_ENV]?.trim();
  if (
    normalized === 'auto' ||
    normalized === 'claude-agent-sdk' ||
    normalized === 'codex-app-server' ||
    normalized === 'cli'
  ) {
    return normalized;
  }
  // unset / empty / unknown → 'cli' (same fallback-to-default pattern as
  // parseDriverPreference, whose default is 'auto'; ours is 'cli' on purpose).
  return 'cli';
}

/**
 * session run 是否启用深度驱动:'cli' 恒 false;
 * 'auto' 仅当 agent client 是 claude 系(Phase 1 保守,codex 待 patch payload 修复);
 * 显式 'claude-agent-sdk' | 'codex-app-server' 恒 true(用户显式要就给)。
 */
export function shouldUseSessionDriver(
  preference: SessionDriverPreference,
  agentClient: string | undefined,
): boolean {
  if (preference === 'cli') {
    return false;
  }
  if (preference === 'auto') {
    // Phase 1 conservative: only claude-family clients opt in under 'auto';
    // codex joins once the app-server patch payload is fixed.
    return clientToDriverKind(agentClient) === 'claude-agent-sdk';
  }
  return true;
}
