import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { currentProtocolVersion, generateWorkspaceId, MesaWorkspaceSchema } from '@agentmesa/protocol';
import type { MesaWorkspace } from '@agentmesa/protocol';
import { deleteFile, ensureDir, readJson, writeJson } from './storage.js';
import { isWorkspaceInitialized } from './workspace.js';
import { MesaError } from './errors.js';

/**
 * Global Mesa home — the single directory that holds cross-workspace state
 * (the workspace registry, and later Room data). It is deliberately distinct
 * from any project-local `.agentmesa/`: a workspace is bound to one project
 * directory, while this is the user-level index of all registered workspaces.
 *
 * `AGENTMESA_HOME` overrides the default so tests and alternate deployments
 * can point it at an isolated directory.
 */
export function getGlobalMesaDir(): string {
  const override = process.env['AGENTMESA_HOME'];
  return override && override.trim().length > 0 ? resolve(override) : join(homedir(), '.agentmesa');
}

const REGISTRY_FILE = 'registry.json';

export interface WorkspaceRegistry {
  version: number;
  activeWorkspaceId?: string;
  workspaces: MesaWorkspace[];
}

function emptyRegistry(): WorkspaceRegistry {
  return { version: 1, workspaces: [] };
}

function registryPath(): string {
  return join(getGlobalMesaDir(), REGISTRY_FILE);
}

export function readRegistry(): WorkspaceRegistry {
  const raw = readJson<WorkspaceRegistry>(registryPath());
  if (!raw) return emptyRegistry();
  // Tolerate a corrupt/missing file by treating it as empty — the registry is
  // an index, never the source of workspace truth.
  if (!Array.isArray(raw.workspaces)) return emptyRegistry();
  return { version: 1, activeWorkspaceId: raw.activeWorkspaceId, workspaces: raw.workspaces };
}

export function writeRegistry(registry: WorkspaceRegistry): void {
  ensureDir(getGlobalMesaDir());
  writeJson(registryPath(), { ...registry, version: 1 });
}

export function listWorkspaces(): MesaWorkspace[] {
  return readRegistry().workspaces;
}

export function getWorkspace(workspaceId: string): MesaWorkspace | null {
  return readRegistry().workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export function addWorkspace(input: { rootDir: string; name?: string }): MesaWorkspace {
  const rootDir = resolve(input.rootDir);
  if (!isWorkspaceInitialized(rootDir)) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Directory is not an AgentMesa workspace: ${rootDir}. Run \`mesa init\` there first.`,
    );
  }

  const registry = readRegistry();
  const existing = registry.workspaces.find((workspace) => workspace.rootDir === rootDir);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const workspace: MesaWorkspace = MesaWorkspaceSchema.parse({
    protocolVersion: currentProtocolVersion,
    id: generateWorkspaceId(),
    name: input.name?.trim() || basename(rootDir),
    rootDir,
    createdAt: now,
    updatedAt: now,
  });

  registry.workspaces.push(workspace);
  if (!registry.activeWorkspaceId) {
    registry.activeWorkspaceId = workspace.id;
  }
  writeRegistry(registry);
  return workspace;
}

export function removeWorkspace(workspaceId: string): void {
  const registry = readRegistry();
  const next = registry.workspaces.filter((workspace) => workspace.id !== workspaceId);
  if (next.length === registry.workspaces.length) {
    throw new MesaError('VALIDATION_ERROR', `Unknown workspace: ${workspaceId}`);
  }
  // If the removed workspace was active, fall back to the first remaining one
  // so the registry never lands in an "active is gone" state.
  const active = registry.activeWorkspaceId === workspaceId
    ? next[0]?.id
    : registry.activeWorkspaceId;
  writeRegistry({ ...registry, workspaces: next, activeWorkspaceId: active });
}

export function setActiveWorkspace(workspaceId: string): MesaWorkspace {
  const registry = readRegistry();
  const workspace = registry.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) {
    throw new MesaError('VALIDATION_ERROR', `Unknown workspace: ${workspaceId}`);
  }
  if (registry.activeWorkspaceId !== workspaceId) {
    writeRegistry({ ...registry, activeWorkspaceId: workspaceId });
  }
  return workspace;
}

export function getActiveWorkspace(): MesaWorkspace | null {
  const registry = readRegistry();
  if (!registry.activeWorkspaceId) return null;
  return registry.workspaces.find((workspace) => workspace.id === registry.activeWorkspaceId) ?? null;
}

/** Remove the registry file entirely (used by tests / reset tooling). */
export function clearRegistry(): void {
  deleteFile(registryPath());
}
