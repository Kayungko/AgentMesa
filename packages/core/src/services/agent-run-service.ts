import { join } from 'node:path';
import {
  MesaAgentRunSchema,
  CreateAgentRunInputSchema,
  generateAgentRunId,
  currentProtocolVersion,
} from '@agentmesa/protocol';
import type { MesaAgentRun, CreateAgentRunInput, RunStatus } from '@agentmesa/protocol';
import { RunNotFoundError, InvalidStatusTransitionError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export type CreateAgentRunRuntimeInput = Omit<CreateAgentRunInput, never>;

export interface AgentRunPatch {
  output?: string;
  outputSummary?: string;
  error?: string;
  producedArtifactIds?: string[];
  meetingId?: string;
}

export interface AgentRunFilter {
  taskId?: string;
  agentId?: string;
  status?: RunStatus;
}

export function createAgentRun(
  ctx: MesaRuntimeContext,
  input: CreateAgentRunRuntimeInput,
): MesaAgentRun {
  assertPolicy(ctx, 'run.create', input.taskId ? `task:${input.taskId}` : 'run');
  const validated = CreateAgentRunInputSchema.parse(input);

  const now = new Date().toISOString();
  const run: MesaAgentRun = {
    protocolVersion: currentProtocolVersion,
    id: generateAgentRunId(),
    meetingId: validated.meetingId,
    taskId: validated.taskId,
    agentId: validated.agentId,
    action: validated.action ?? 'implement',
    runnerType: validated.runnerType,
    status: 'pending',
    input: validated.input,
    producedArtifactIds: [],
    startedAt: now,
  };

  const result = MesaAgentRunSchema.parse(run);
  writeRun(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: result.meetingId ?? result.taskId ?? 'workspace',
    type: 'agent_run_created',
    streamId: result.id,
    streamType: 'agent_run',
    data: { run: result },
  });

  return result;
}

export function updateAgentRunStatus(
  ctx: MesaRuntimeContext,
  runId: string,
  status: RunStatus,
  patch?: AgentRunPatch,
): MesaAgentRun {
  assertPolicy(ctx, 'run.updateStatus', `run:${runId}`);
  const run = getAgentRun(ctx, runId);

  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['running', 'cancelled'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };

  const allowed = VALID_TRANSITIONS[run.status];
  if (!allowed || !allowed.includes(status)) {
    throw new InvalidStatusTransitionError(run.status, status);
  }

  const now = new Date().toISOString();
  const updated: MesaAgentRun = {
    ...run,
    status,
    completedAt: status === 'completed' || status === 'failed' || status === 'cancelled' ? now : run.completedAt,
    duration: (status === 'completed' || status === 'failed' || status === 'cancelled')
      ? new Date(now).getTime() - new Date(run.startedAt).getTime()
      : run.duration,
    ...(patch?.output !== undefined ? { output: patch.output } : {}),
    ...(patch?.outputSummary !== undefined ? { outputSummary: patch.outputSummary } : {}),
    ...(patch?.error !== undefined ? { error: patch.error } : {}),
    ...(patch?.producedArtifactIds !== undefined
      ? { producedArtifactIds: [...new Set([...run.producedArtifactIds, ...patch.producedArtifactIds])] }
      : {}),
    ...(patch?.meetingId !== undefined ? { meetingId: patch.meetingId } : {}),
  };

  const result = MesaAgentRunSchema.parse(updated);
  writeRun(ctx, result);

  const eventType =
    status === 'completed' ? 'agent_run_completed' as const :
    status === 'failed' ? 'agent_run_failed' as const :
    status === 'cancelled' ? 'agent_run_cancelled' as const :
    'agent_run_status_changed' as const;

  appendRuntimeEvent(ctx, {
    meetingId: result.meetingId ?? result.taskId ?? 'workspace',
    type: eventType,
    streamId: result.id,
    streamType: 'agent_run',
    data: { previousStatus: run.status, newStatus: status, run: result },
  });

  return result;
}

export function getAgentRun(ctx: MesaRuntimeContext, runId: string): MesaAgentRun {
  const run = readJsonFromStorage<MesaAgentRun>(
    ctx,
    join(ctx.paths.runsDir, `${runId}.json`),
  );
  if (!run) {
    throw new RunNotFoundError(runId);
  }
  return MesaAgentRunSchema.parse(run);
}

export function listAgentRuns(
  ctx: MesaRuntimeContext,
  filter?: AgentRunFilter,
): MesaAgentRun[] {
  let runs = listJsonFromStorage<MesaAgentRun>(ctx, ctx.paths.runsDir)
    .map((r) => MesaAgentRunSchema.safeParse(r))
    .map((r, index) => {
      if (!r.success) {
        ctx.logger.warn(
          `Skipping schema-invalid agent run file (#${index} in ${ctx.paths.runsDir}): ${r.error.issues.map((i) => i.message).join('; ')}`,
        );
        return null;
      }
      return r.data;
    })
    .filter((r): r is MesaAgentRun => r !== null);

  if (filter?.taskId) {
    runs = runs.filter((r) => r.taskId === filter.taskId);
  }
  if (filter?.agentId) {
    runs = runs.filter((r) => r.agentId === filter.agentId);
  }
  if (filter?.status) {
    runs = runs.filter((r) => r.status === filter.status);
  }

  return runs;
}

function writeRun(ctx: MesaRuntimeContext, run: MesaAgentRun): void {
  writeJsonToStorage(ctx, join(ctx.paths.runsDir, `${run.id}.json`), run);
}
