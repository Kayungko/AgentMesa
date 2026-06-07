import type {
  AgentRole,
  MesaEvent,
  PermissionLevel,
} from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';

export type MesaActorType = 'user' | 'agent' | 'system' | 'cli' | 'ci';

export interface MesaActor {
  id: string;
  type: MesaActorType;
  roles: Array<AgentRole | PermissionLevel>;
  client?: string;
}

export interface MesaConfig {
  protocolVersion: string;
  projectName?: string;
  defaultBuilder?: string;
  defaultReviewer?: string;
}

export interface MesaStorageAdapter {
  readText(path: string): string | null;
  writeText(path: string, content: string): void;
  delete(path: string): boolean;
  exists(path: string): boolean;
  list(path: string): string[];
  ensureDirectory(path: string): void;
}

export interface MesaEventFilter {
  meetingId?: string;
  type?: MesaEvent['type'];
  streamId?: string;
  streamType?: string;
  actor?: string;
}

export interface MesaEventStore {
  append(event: MesaEvent): void;
  list(filter?: MesaEventFilter): MesaEvent[];
}

export interface MesaPolicyDecision {
  allowed: boolean;
  requiresApproval?: boolean;
  reason?: string;
}

export interface MesaPolicyEngine {
  can(actor: MesaActor, action: string, resource: string): MesaPolicyDecision;
}

export interface MesaLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface MesaRuntimeContext {
  readonly rootDir: string;
  readonly paths: MesaWorkspacePaths;
  readonly config: MesaConfig;
  readonly actor: MesaActor;
  readonly storage: MesaStorageAdapter;
  readonly eventStore: MesaEventStore;
  readonly policy: MesaPolicyEngine;
  readonly logger: MesaLogger;
}

export interface CreateRuntimeContextOptions {
  rootDir: string;
  actor: MesaActor;
  storage?: MesaStorageAdapter;
  eventStore?: MesaEventStore;
  policy?: MesaPolicyEngine;
  logger?: MesaLogger;
}
