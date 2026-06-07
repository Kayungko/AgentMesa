import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mesaProtocolVersion } from '@agentmesa/protocol';
import { ensureDir, readJson, writeJson } from './storage.js';
import { WorkspaceNotFoundError, WorkspaceAlreadyExistsError } from './errors.js';

export interface MesaWorkspacePaths {
  rootDir: string;
  mesaDir: string;
  tasksDir: string;
  messagesDir: string;
  artifactsDir: string;
  meetingsDir: string;
  agentsDir: string;
  logsDir: string;
  locksDir: string;
}

export interface MesaConfig {
  protocolVersion: string;
  projectName?: string;
  defaultBuilder?: string;
  defaultReviewer?: string;
}

export function createWorkspacePaths(rootDir: string): MesaWorkspacePaths {
  const mesaDir = join(rootDir, '.agentmesa');

  return {
    rootDir,
    mesaDir,
    tasksDir: join(mesaDir, 'tasks'),
    messagesDir: join(mesaDir, 'messages'),
    artifactsDir: join(mesaDir, 'artifacts'),
    meetingsDir: join(mesaDir, 'meetings'),
    agentsDir: join(mesaDir, 'agents'),
    logsDir: join(mesaDir, 'logs'),
    locksDir: join(mesaDir, 'locks'),
  };
}

export function isWorkspaceInitialized(rootDir: string): boolean {
  const mesaDir = join(rootDir, '.agentmesa');
  return existsSync(join(mesaDir, 'config.json'));
}

export function initWorkspace(rootDir: string): MesaWorkspacePaths {
  if (isWorkspaceInitialized(rootDir)) {
    throw new WorkspaceAlreadyExistsError(rootDir);
  }

  const paths = createWorkspacePaths(rootDir);

  ensureDir(paths.mesaDir);
  ensureDir(paths.tasksDir);
  ensureDir(paths.messagesDir);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.meetingsDir);
  ensureDir(paths.agentsDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.locksDir);

  const config: MesaConfig = {
    protocolVersion: mesaProtocolVersion,
  };

  writeJson(join(paths.mesaDir, 'config.json'), config);

  return paths;
}

export function loadConfig(rootDir: string): MesaConfig {
  const configPath = join(rootDir, '.agentmesa', 'config.json');
  const config = readJson<MesaConfig>(configPath);

  if (!config) {
    throw new WorkspaceNotFoundError(rootDir);
  }

  return config;
}
