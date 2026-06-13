import { describe, it, expect } from 'vitest';
import {
  FileTransport,
  createDefaultTransports,
  findTransportsByType,
  getAvailableTransports,
} from '../runtime/transports.js';

describe('FileTransport', () => {
  const file = new FileTransport();

  it('has correct name and type', () => {
    expect(file.name).toBe('File Transport');
    expect(file.type).toBe('file');
  });

  it('has protocol version', () => {
    expect(file.version).toBe('0.2.0');
  });

  it('is always available', () => {
    expect(file.isAvailable()).toBe(true);
  });

  it('declares full read/write capabilities', () => {
    expect(file.capabilities.canCreateTasks).toBe(true);
    expect(file.capabilities.canReadTasks).toBe(true);
    expect(file.capabilities.canUpdateTaskStatus).toBe(true);
    expect(file.capabilities.canPostMessages).toBe(true);
    expect(file.capabilities.canAttachArtifacts).toBe(true);
    expect(file.capabilities.canCreateMeetings).toBe(true);
    expect(file.capabilities.canRegisterAgents).toBe(true);
  });

  it('does not support push or bidirectional', () => {
    expect(file.capabilities.supportsPush).toBe(false);
    expect(file.capabilities.supportsBidirectional).toBe(false);
  });
});

describe('createDefaultTransports', () => {
  it('includes FileTransport', () => {
    const transports = createDefaultTransports();
    expect(transports.length).toBe(1);
    expect(transports[0]!).toBeInstanceOf(FileTransport);
  });
});

describe('findTransportsByType', () => {
  it('finds file transport by type', () => {
    const transports = createDefaultTransports();
    const found = findTransportsByType(transports, 'file');
    expect(found.length).toBe(1);
    expect(found[0]!.type).toBe('file');
  });

  it('returns empty array for unknown type', () => {
    const transports = createDefaultTransports();
    expect(findTransportsByType(transports, 'websocket').length).toBe(0);
  });
});

describe('getAvailableTransports', () => {
  it('returns all transports when they are available', () => {
    const transports = createDefaultTransports();
    const available = getAvailableTransports(transports);
    expect(available.length).toBe(transports.length);
  });
});

describe('MesaRuntimeContext transports field', () => {
  it('context includes transports array', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    expect(Array.isArray(ctx.transports)).toBe(true);
    expect(ctx.transports.length).toBeGreaterThanOrEqual(1);
    expect(ctx.transports[0]!.type).toBe('file');
  });

  it('context accepts custom transports', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      transports: [new FileTransport()],
    });
    expect(ctx.transports.length).toBe(1);
  });
});
