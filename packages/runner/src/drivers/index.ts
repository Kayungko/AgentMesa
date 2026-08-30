/**
 * Deep-driver assembly (M4).
 *
 * Builds the default driver registry from the real backends. Callers that need
 * test seams construct drivers directly and pass their own registry; this
 * module is the production wiring — `executeRun` receives the result of
 * `createDefaultDriverRegistry()` at the call sites (CLI / MCP server /
 * orchestrator), and falls back to the CLI runners whenever a driver reports
 * itself unavailable.
 *
 * Command overrides, when set, are picked up from the environment:
 * - `AGENTMESA_CODEX_APP_SERVER_CMD` (CodexAppServerDriver constructor)
 * - Claude SDK resolves the Claude Code CLI through the SDK itself.
 */

import { ClaudeSdkDriver } from './claude-sdk-driver.js';
import { CodexAppServerDriver } from './codex-app-server-driver.js';
import type { AgentDriver } from './types.js';

/** Fresh driver instances; each owns its own child processes / SDK handles, so do not share one registry across concurrent executors that mutate it. */
export function createDefaultDriverRegistry(): AgentDriver[] {
  return [new ClaudeSdkDriver(), new CodexAppServerDriver()];
}

export { ClaudeSdkDriver } from './claude-sdk-driver.js';
export type { ClaudeSdkDriverOptions } from './claude-sdk-driver.js';
export { CodexAppServerDriver } from './codex-app-server-driver.js';
export type { CodexAppServerDriverOptions } from './codex-app-server-driver.js';
