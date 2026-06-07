import { join } from 'node:path';
import {
  MesaArtifactSchema,
  CreateArtifactInputSchema,
  currentProtocolVersion,
  generateArtifactId,
} from '@agentmesa/protocol';
import type { MesaArtifact, CreateArtifactInput, ArtifactKind } from '@agentmesa/protocol';
import { ArtifactNotFoundError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export type CreateArtifactRuntimeInput = Omit<CreateArtifactInput, 'createdBy'> & {
  createdBy?: string;
};

export function createArtifact(
  ctx: MesaRuntimeContext,
  input: CreateArtifactRuntimeInput
): MesaArtifact {
  assertPolicy(ctx, 'artifact.create', input.taskId ? `task:${input.taskId}` : 'artifact');
  const validated = CreateArtifactInputSchema.parse({
    ...input,
    createdBy: ctx.actor.id,
  });

  const artifact: MesaArtifact = {
    protocolVersion: currentProtocolVersion,
    id: generateArtifactId(),
    kind: validated.kind,
    taskId: validated.taskId,
    createdBy: validated.createdBy,
    content: validated.content,
    mimeType: validated.mimeType ?? 'text/markdown',
    version: 1,
    tags: validated.tags ?? [],
    format: validated.format,
    metadata: validated.metadata,
    createdAt: new Date().toISOString(),
  };

  const result = MesaArtifactSchema.parse(artifact);
  writeArtifact(ctx, result);

  appendRuntimeEvent(ctx, {
    meetingId: result.taskId ?? 'workspace',
    type: 'artifact_created',
    streamId: result.id,
    streamType: 'artifact',
    data: { artifact: result },
  });

  return result;
}

export function getArtifact(ctx: MesaRuntimeContext, artifactId: string): MesaArtifact {
  const artifact = readJsonFromStorage<MesaArtifact>(
    ctx,
    join(ctx.paths.artifactsDir, `${artifactId}.json`)
  );
  if (!artifact) {
    throw new ArtifactNotFoundError(artifactId);
  }
  return MesaArtifactSchema.parse(artifact);
}

export function listArtifacts(
  ctx: MesaRuntimeContext,
  taskId?: string,
  kind?: ArtifactKind
): MesaArtifact[] {
  let artifacts = listJsonFromStorage<MesaArtifact>(ctx, ctx.paths.artifactsDir)
    .map((a) => MesaArtifactSchema.safeParse(a))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaArtifact }).data);

  if (taskId) {
    artifacts = artifacts.filter((a) => a.taskId === taskId);
  }
  if (kind) {
    artifacts = artifacts.filter((a) => a.kind === kind);
  }

  return artifacts;
}

function writeArtifact(ctx: MesaRuntimeContext, artifact: MesaArtifact): void {
  writeJsonToStorage(
    ctx,
    join(ctx.paths.artifactsDir, `${artifact.id}.json`),
    artifact
  );
}
