export type {
  RunnerType,
  RunOptions,
  RunResult,
  Runner,
  PromptBuilderDeps,
} from './types.js';

export {
  buildImplementPrompt,
  buildFixPrompt,
  buildReviewPrompt,
  buildTestPrompt,
  buildDocumentPrompt,
  buildSessionPrompt,
} from './prompt-builder.js';

export {
  parseRunOutput,
  extractChangedFiles,
} from './output-parser.js';
export type { ParsedRunOutput } from './output-parser.js';

export { AbstractRunner } from './runners/base-runner.js';
export { ClaudeRunner } from './runners/claude-runner.js';
export { CodexRunner } from './runners/codex-runner.js';
export { ShellRunner } from './runners/shell-runner.js';
export { SessionRunner } from './runners/session-runner.js';
export { createRunner } from './runner-factory.js';
export { runCli, runCliAsync } from './runners/cli-runner.js';
export type { CliInvocation, CliResult } from './runners/cli-runner.js';

export { executeRun, resolveRunnerType, isRunnerType } from './run-executor.js';
export type { RunExecutorOptions, RunExecutionResult } from './run-executor.js';

export { executeSessionRun, activateSessionAgent } from './session-run.js';
export type { SessionRunOptions, ActivateSessionAgentOptions } from './session-run.js';

export {
  trackSessionChild,
  terminateSessionChildren,
  activeSessionChildCount,
} from './session-children.js';

// --- M4 Deep Orchestration (drivers) ---

export type {
  AgentDriver,
  AgentDriverSession,
  DriverEvent,
  DriverKind,
  DriverPermissionRequest,
  DriverPreference,
  DriverSessionHandle,
  DriverSessionInit,
  DriverTurnInput,
} from './drivers/types.js';

export {
  DRIVER_PREFERENCE_ENV,
  DRIVER_SESSIONS_DIR,
  clientToDriverKind,
  driverSessionScope,
  loadDriverSessionHandle,
  parseDriverPreference,
  resolveDriverPreference,
  resolveDriverTransport,
  saveDriverSessionHandle,
} from './drivers/resolve.js';
export type { DriverTransportResolution } from './drivers/resolve.js';

export { createDefaultDriverRegistry } from './drivers/index.js';
export { ClaudeSdkDriver } from './drivers/index.js';
export type { ClaudeSdkDriverOptions } from './drivers/index.js';
export { CodexAppServerDriver } from './drivers/index.js';
export type { CodexAppServerDriverOptions } from './drivers/index.js';

export { executeDriverTurn } from './run-executor.js';
export type {
  DriverPermissionResponder,
  DriverTurnOutcome,
  DriverTurnParams,
} from './run-executor.js';

export {
  resolveDriverRegistryFromEnv,
  resolveSessionDriverPreference,
  shouldUseSessionDriver,
  SESSION_DRIVER_PREFERENCE_ENV,
} from './drivers/env.js';
export type { DriverEnvSource, SessionDriverPreference } from './drivers/env.js';

export {
  attachPermissionResponder,
  createPolicyPermissionResponder,
  DEFAULT_COMMAND_ALLOWLIST,
} from './drivers/permission-bridge.js';
export type {
  AttachPermissionResponderOptions,
  PermissionDecisionRecord,
  PolicyPermissionResponderOptions,
  ToolPolicyMap,
} from './drivers/permission-bridge.js';

