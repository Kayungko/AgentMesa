import { join } from 'node:path';
import {
  MesaCheckResultSchema,
  CreateCheckResultInputSchema,
  generateCheckResultId,
  currentProtocolVersion,
} from '@agentmesa/protocol';
import type { MesaCheckResult, CreateCheckResultInput, CheckKind, CheckResultStatus } from '@agentmesa/protocol';
import { CheckResultNotFoundError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export type CreateCheckResultRuntimeInput = CreateCheckResultInput;

export interface CheckResultFilter {
  taskId?: string;
  kind?: CheckKind;
  status?: CheckResultStatus;
}

export function createCheckResult(
  ctx: MesaRuntimeContext,
  input: CreateCheckResultRuntimeInput,
): MesaCheckResult {
  assertPolicy(ctx, 'check.create', `task:${input.taskId}`);
  const validated = CreateCheckResultInputSchema.parse(input);

  const now = new Date().toISOString();
  const check: MesaCheckResult = {
    protocolVersion: currentProtocolVersion,
    id: generateCheckResultId(),
    taskId: validated.taskId,
    runId: validated.runId,
    kind: validated.kind ?? 'test',
    status: validated.status,
    checkName: validated.checkName,
    exitCode: validated.exitCode ?? 0,
    stdout: validated.stdout,
    stderr: validated.stderr,
    duration: validated.duration,
    success: validated.success,
    summary: validated.summary,
    detail: validated.detail,
    createdAt: now,
  };

  const result = MesaCheckResultSchema.parse(check);
  writeCheckResult(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: result.taskId,
    type: 'check_completed',
    streamId: result.id,
    streamType: 'check_result',
    data: { check: result },
  });

  return result;
}

export function getCheckResult(ctx: MesaRuntimeContext, checkId: string): MesaCheckResult {
  const check = readJsonFromStorage<MesaCheckResult>(
    ctx,
    join(ctx.paths.checksDir, `${checkId}.json`),
  );
  if (!check) {
    throw new CheckResultNotFoundError(checkId);
  }
  return MesaCheckResultSchema.parse(check);
}

export function listCheckResults(
  ctx: MesaRuntimeContext,
  filter?: CheckResultFilter,
): MesaCheckResult[] {
  let checks = listJsonFromStorage<MesaCheckResult>(ctx, ctx.paths.checksDir)
    .map((c) => MesaCheckResultSchema.safeParse(c))
    .map((c, index) => {
      if (!c.success) {
        ctx.logger.warn(
          `Skipping schema-invalid check result file (#${index} in ${ctx.paths.checksDir}): ${c.error.issues.map((i) => i.message).join('; ')}`,
        );
        return null;
      }
      return c.data;
    })
    .filter((c): c is MesaCheckResult => c !== null);

  if (filter?.taskId) {
    checks = checks.filter((c) => c.taskId === filter.taskId);
  }
  if (filter?.kind) {
    checks = checks.filter((c) => c.kind === filter.kind);
  }
  if (filter?.status) {
    checks = checks.filter((c) => c.status === filter.status);
  }

  return checks;
}

function writeCheckResult(ctx: MesaRuntimeContext, check: MesaCheckResult): void {
  writeJsonToStorage(ctx, join(ctx.paths.checksDir, `${check.id}.json`), check);
}
