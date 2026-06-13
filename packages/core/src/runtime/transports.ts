import type { MesaTransportCapabilities } from '@agentmesa/protocol';
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

export class FileTransport implements MesaTransport {
  readonly name = 'File Transport';
  readonly type = 'file' as const;
  readonly capabilities = FILE_TRANSPORT_CAPABILITIES;
  readonly version = '0.2.0';

  isAvailable(): boolean {
    // File transport is always available — it only requires a filesystem,
    // and if you can create a runtime context, you have a filesystem.
    return true;
  }
}

// --- Transport registry helpers ---

export function createDefaultTransports(): MesaTransport[] {
  return [new FileTransport()];
}

export function findTransportsByType(
  transports: MesaTransport[],
  type: string
): MesaTransport[] {
  return transports.filter((t) => t.type === type);
}

export function getAvailableTransports(
  transports: MesaTransport[]
): MesaTransport[] {
  return transports.filter((t) => t.isAvailable());
}
