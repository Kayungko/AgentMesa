import {
  MesaError,
  getAgentRun,
  updateAgentRunStatus,
  createArtifact,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgentRun } from '@agentmesa/protocol';
import type { RunResult, RunnerType } from './types.js';
import { createRunner } from './runner-factory.js';
import { parseRunOutput } from './output-parser.js';

const RUNNER_TYPES: readonly RunnerType[] = [
  'claude-implement',
  'claude-fix',
  'codex-review',
  'codex-test',
  'shell-check',
  'document',
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

export interface RunExecutorOptions {
  dryRun?: boolean;
  /** Persist run output as an artifact. Default true; always skipped on dry run. */
  createArtifacts?: boolean;
  timeout?: number;
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

  const runner = createRunner(runnerType, ctx.paths, dryRun);

  let result: RunResult;
  try {
    result = await runner.run({
      taskId: run.taskId ?? '',
      runnerType,
      agentId: run.agentId,
      dryRun,
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
      extraPrompt: run.input,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAgentRunStatus(ctx, runId, 'failed', { error: message });
    throw err;
  }

  if (!result.success) {
    const parsed = parseRunOutput(result.output);
    const failed = updateAgentRunStatus(ctx, runId, 'failed', {
      error: result.output,
      outputSummary: parsed.summary,
    });
    return { run: failed, result };
  }

  const producedArtifactIds: string[] = [];
  if (createArtifacts && !dryRun) {
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
  const completed = updateAgentRunStatus(ctx, runId, 'completed', {
    output: result.output,
    outputSummary: parsed.summary,
    ...(producedArtifactIds.length > 0 ? { producedArtifactIds } : {}),
  });

  return { run: completed, result };
}
