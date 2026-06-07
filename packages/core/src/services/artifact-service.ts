import { join } from 'node:path';
import {
  MesaArtifactSchema,
  CreateArtifactInputSchema,
  mesaProtocolVersion,
} from '@agentmesa/protocol';
import type { MesaArtifact, CreateArtifactInput, ArtifactKind } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import { readJson, writeJson, listJson } from '../storage.js';
import { ArtifactNotFoundError } from '../errors.js';

let artifactCounter = 0;

function generateArtifactId(): string {
  artifactCounter++;
  return `A-${String(artifactCounter).padStart(4, '0')}`;
}

export function resetArtifactCounter(): void {
  artifactCounter = 0;
}

export function createArtifact(paths: MesaWorkspacePaths, input: CreateArtifactInput): MesaArtifact {
  const validated = CreateArtifactInputSchema.parse(input);

  const artifact: MesaArtifact = {
    protocolVersion: mesaProtocolVersion,
    id: generateArtifactId(),
    kind: validated.kind,
    taskId: validated.taskId,
    createdBy: validated.createdBy,
    content: validated.content,
    format: validated.format,
    metadata: validated.metadata,
    createdAt: new Date().toISOString(),
  };

  const result = MesaArtifactSchema.parse(artifact);
  writeJson(join(paths.artifactsDir, `${artifact.id}.json`), result);

  return result;
}

export function getArtifact(paths: MesaWorkspacePaths, artifactId: string): MesaArtifact {
  const artifact = readJson<MesaArtifact>(join(paths.artifactsDir, `${artifactId}.json`));
  if (!artifact) {
    throw new ArtifactNotFoundError(artifactId);
  }
  return MesaArtifactSchema.parse(artifact);
}

export function listArtifacts(
  paths: MesaWorkspacePaths,
  taskId?: string,
  kind?: ArtifactKind
): MesaArtifact[] {
  let artifacts = listJson<MesaArtifact>(paths.artifactsDir)
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
