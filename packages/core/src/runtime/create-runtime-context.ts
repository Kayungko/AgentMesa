import { join, resolve } from 'node:path';
import { currentProtocolVersion } from '@agentmesa/protocol';
import { MesaError } from '../errors.js';
import { createWorkspacePaths } from '../workspace.js';
import { InMemoryMesaEventStore } from './event-store.js';
import { FileEventStore } from './file-event-store.js';
import { FileStorageAdapter } from './file-storage-adapter.js';
import { createConsoleLogger } from './logger.js';
import { AllowAllMesaPolicyEngine, RoleBasedPolicyEngine } from './policy.js';
import { createDefaultTransports } from './transports.js';
import type {
  CreateRuntimeContextOptions,
  MesaConfig,
  MesaRuntimeContext,
  MesaStorageAdapter,
} from './types.js';

export function createRuntimeContext(
  options: CreateRuntimeContextOptions
): MesaRuntimeContext {
  const rootDir = resolve(options.rootDir);
  const paths = createWorkspacePaths(rootDir);
  const storage = options.storage ?? new FileStorageAdapter();

  for (const directory of [
    paths.mesaDir,
    paths.tasksDir,
    paths.messagesDir,
    paths.artifactsDir,
    paths.meetingsDir,
    paths.agentsDir,
    paths.logsDir,
    paths.locksDir,
    paths.eventsDir,
    paths.projectionsDir,
    paths.taskProjectionsDir,
    paths.meetingProjectionsDir,
    paths.agentProjectionsDir,
  ]) {
    storage.ensureDirectory(directory);
  }

  const configPath = join(paths.mesaDir, 'config.json');
  const config = loadOrCreateConfig(storage.readText(configPath), configPath, storage);

  return {
    rootDir,
    paths,
    config,
    actor: options.actor,
    storage,
    eventStore: options.eventStore ?? new FileEventStore(paths.eventsDir),
    policy: options.policy ?? resolvePolicyEngine(config),
    logger: options.logger ?? createConsoleLogger(options.actor),
    transports: options.transports ?? createDefaultTransports(),
  };
}

function resolvePolicyEngine(config: MesaConfig): AllowAllMesaPolicyEngine | RoleBasedPolicyEngine {
  if (config.policy?.mode === 'role-based') {
    return new RoleBasedPolicyEngine();
  }
  return new AllowAllMesaPolicyEngine();
}

function loadOrCreateConfig(
  content: string | null,
  configPath: string,
  storage: MesaStorageAdapter
): MesaConfig {
  if (content === null) {
    const config: MesaConfig = {
      protocolVersion: currentProtocolVersion,
      readModel: { mode: 'hybrid' },
    };
    storage.writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  }

  try {
    const parsed = JSON.parse(content) as Partial<MesaConfig>;
    if (typeof parsed.protocolVersion !== 'string') {
      throw new Error('protocolVersion is required');
    }
    return {
      ...parsed,
      readModel: { mode: parsed.readModel?.mode ?? 'hybrid' },
    } as MesaConfig;
  } catch (error) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Invalid AgentMesa config at ${configPath}: ${String(error)}`
    );
  }
}
