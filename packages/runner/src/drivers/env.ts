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
import { DRIVER_PREFERENCE_ENV, parseDriverPreference } from './resolve.js';
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
