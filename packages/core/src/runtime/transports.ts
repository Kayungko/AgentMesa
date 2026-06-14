import {
  TransportCapabilitiesSchema,
  TransportEnvelopeSchema,
} from '@agentmesa/protocol';
import type {
  MesaTransportCapabilities,
  TransportEnvelope,
  TransportEnvelopeStatus,
} from '@agentmesa/protocol';
import { join } from 'node:path';
import { MesaError } from '../errors.js';
import type { FileStorageAdapter } from './file-storage-adapter.js';
import type { MesaTransport } from './types.js';

// --- File Transport ---

const FILE_TRANSPORT_CAPABILITIES: MesaTransportCapabilities = {
  canCreateTasks: true,
  canReadTasks: true,
  canUpdateTaskStatus: true,
  canPostMessages: true,
  canAttachArtifacts: true,
  canCreateMeetings: true,
  canRegisterAgents: true,
  supportsPush: false,
  supportsBidirectional: false,
};

function safeEnvelopeFilename(id: string): string {
  if (!/^[a-z][\w-]*$/i.test(id)) {
    throw new MesaError('VALIDATION_ERROR', `Unsafe envelope ID for filename: ${id}`);
  }
  return `${id}.json`;
}

export class FileTransport implements MesaTransport {
  readonly name = 'File Transport';
  readonly type = 'file' as const;
  readonly capabilities = FILE_TRANSPORT_CAPABILITIES;
  readonly version = '0.2.0';

  private readonly inboxDir?: string;
  private readonly outboxDir?: string;
  private readonly storage?: FileStorageAdapter;

  constructor(
    paths?: { inboxDir: string; outboxDir: string },
    storage?: FileStorageAdapter,
  ) {
    this.inboxDir = paths?.inboxDir;
    this.outboxDir = paths?.outboxDir;
    this.storage = storage;
  }

  isAvailable(): boolean {
    return true;
  }

  private requireStorage(): FileStorageAdapter {
    if (!this.storage) {
      throw new MesaError('STORAGE_ERROR', 'FileTransport has no storage adapter configured');
    }
    return this.storage;
  }

  private requireInboxDir(): string {
    if (!this.inboxDir) {
      throw new MesaError('STORAGE_ERROR', 'FileTransport has no inbox directory set');
    }
    return this.inboxDir;
  }

  private requireOutboxDir(): string {
    if (!this.outboxDir) {
      throw new MesaError('STORAGE_ERROR', 'FileTransport has no outbox directory set');
    }
    return this.outboxDir;
  }

  writeInbound(envelope: TransportEnvelope): void {
    const dir = this.requireInboxDir();
    const storage = this.requireStorage();
    const parsed = TransportEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new MesaError('VALIDATION_ERROR', `Invalid transport envelope: ${parsed.error.message}`);
    }
    const file = join(dir, safeEnvelopeFilename(envelope.id));
    storage.writeText(file, JSON.stringify(parsed.data, null, 2) + '\n');
  }

  writeOutbound(envelope: TransportEnvelope): void {
    const dir = this.requireOutboxDir();
    const storage = this.requireStorage();
    const parsed = TransportEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new MesaError('VALIDATION_ERROR', `Invalid transport envelope: ${parsed.error.message}`);
    }
    const file = join(dir, safeEnvelopeFilename(envelope.id));
    storage.writeText(file, JSON.stringify(parsed.data, null, 2) + '\n');
  }

  listInbound(status?: TransportEnvelopeStatus): TransportEnvelope[] {
    const dir = this.requireInboxDir();
    const storage = this.requireStorage();
    return this.listEnvelopes(dir, storage, status);
  }

  listOutbound(status?: TransportEnvelopeStatus): TransportEnvelope[] {
    const dir = this.requireOutboxDir();
    const storage = this.requireStorage();
    return this.listEnvelopes(dir, storage, status);
  }

  markProcessed(id: string): boolean {
    return this.updateStatus(id, 'processed');
  }

  markFailed(id: string, error: string): boolean {
    return this.updateStatus(id, 'failed', error);
  }

  private listEnvelopes(
    dir: string,
    storage: FileStorageAdapter,
    status?: TransportEnvelopeStatus,
  ): TransportEnvelope[] {
    const files = storage.list(dir).filter((f) => f.endsWith('.json'));
    const envelopes: TransportEnvelope[] = [];
    for (const f of files) {
      const content = storage.readText(join(dir, f));
      if (content) {
        try {
          const parsed = TransportEnvelopeSchema.parse(JSON.parse(content));
          if (!status || parsed.status === status) {
            envelopes.push(parsed);
          }
        } catch {
          // Skip corrupted envelopes silently during listing;
          // diagnostics pick them up via explicit read attempt.
        }
      }
    }
    return envelopes;
  }

  private updateStatus(
    id: string,
    status: TransportEnvelopeStatus,
    error?: string,
  ): boolean {
    const dir = this.requireInboxDir();
    const storage = this.requireStorage();
    const file = join(dir, safeEnvelopeFilename(id));
    const content = storage.readText(file);
    if (!content) return false;
    try {
      const envelope = TransportEnvelopeSchema.parse(JSON.parse(content));
      envelope.status = status;
      if (error !== undefined) envelope.error = error;
      storage.writeText(file, JSON.stringify(envelope, null, 2) + '\n');
      return true;
    } catch {
      return false;
    }
  }
}

// --- Transport registry helpers ---

export function createDefaultTransports(
  paths?: { inboxDir: string; outboxDir: string },
  storage?: FileStorageAdapter,
): MesaTransport[] {
  return [new FileTransport(paths, storage)];
}

export function findTransportsByType(
  transports: MesaTransport[],
  type: string,
): MesaTransport[] {
  return transports.filter((t) => t.type === type);
}

export function getAvailableTransports(
  transports: MesaTransport[],
): MesaTransport[] {
  return transports.filter((t) => t.isAvailable());
}
