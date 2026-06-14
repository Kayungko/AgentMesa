import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateEnvelopeId } from '@agentmesa/protocol';
import { MesaError, PolicyDeniedError } from '../errors.js';
import {
  FileTransport,
  createDefaultTransports,
  findTransportsByType,
  getAvailableTransports,
} from '../runtime/transports.js';
import {
  registerTransport,
  listTransports,
  getTransport,
  inspectTransport,
} from '../runtime/transport-registry.js';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import type { TransportEnvelope } from '@agentmesa/protocol';

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

// --- FileTransport inbox/outbox ---

describe('FileTransport inbox/outbox', () => {
  let testDir: string;
  let storage: FileStorageAdapter;
  let transport: FileTransport;

  const makeEnvelope = (overrides: Partial<TransportEnvelope> = {}): TransportEnvelope => ({
    id: generateEnvelopeId(),
    protocolVersion: '0.2.0',
    transport: 'File Transport',
    direction: 'inbound',
    actor: 'user',
    type: 'task_created',
    payload: { title: 'Test' },
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  } as TransportEnvelope);

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'agentmesa-mailbox-'));
    storage = new FileStorageAdapter();
    const inboxDir = join(testDir, 'inbox');
    const outboxDir = join(testDir, 'outbox');
    storage.ensureDirectory(inboxDir);
    storage.ensureDirectory(outboxDir);
    transport = new FileTransport({ inboxDir, outboxDir }, storage);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes and lists inbound envelope', () => {
    const env = makeEnvelope();
    transport.writeInbound!(env);
    const list = transport.listInbound!();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(env.id);
    expect(list[0]!.status).toBe('pending');
  });

  it('writes and lists outbound envelope', () => {
    const env = makeEnvelope({ direction: 'outbound' });
    transport.writeOutbound!(env);
    const list = transport.listOutbound!();
    expect(list).toHaveLength(1);
    expect(list[0]!.direction).toBe('outbound');
  });

  it('filters by status', () => {
    transport.writeInbound!(makeEnvelope());
    const processedEnv = makeEnvelope({ status: 'processed' });
    transport.writeInbound!(processedEnv);
    expect(transport.listInbound!('pending')).toHaveLength(1);
    expect(transport.listInbound!('processed')).toHaveLength(1);
    expect(transport.listInbound!('failed')).toHaveLength(0);
  });

  it('markProcessed updates status', () => {
    const env = makeEnvelope();
    transport.writeInbound!(env);
    const ok = transport.markProcessed!(env.id);
    expect(ok).toBe(true);
    const list = transport.listInbound!();
    expect(list[0]!.status).toBe('processed');
  });

  it('markFailed updates status with error', () => {
    const env = makeEnvelope();
    transport.writeInbound!(env);
    const ok = transport.markFailed!(env.id, 'Parse error');
    expect(ok).toBe(true);
    const list = transport.listInbound!();
    expect(list[0]!.status).toBe('failed');
    expect(list[0]!.error).toBe('Parse error');
  });

  it('markProcessed returns false for nonexistent id', () => {
    expect(transport.markProcessed!('nonexistent')).toBe(false);
  });

  it('markFailed returns false for nonexistent id', () => {
    expect(transport.markFailed!('nonexistent', 'err')).toBe(false);
  });

  it('validates envelope schema on write', () => {
    expect(() =>
      transport.writeInbound!({ id: 'bad', transport: 'X' } as TransportEnvelope),
    ).toThrow(MesaError);
  });

  it('rejects unsafe filename characters', () => {
    const env = makeEnvelope({ id: '../../etc/passwd' });
    expect(() => transport.writeInbound!(env)).toThrow(MesaError);
  });

  it('skips corrupted envelope files during listing', () => {
    const env = makeEnvelope();
    transport.writeInbound!(env);
    const corruptFile = join(testDir, 'inbox', 'corrupt.json');
    storage.writeText(corruptFile, 'not valid json {{{');
    const list = transport.listInbound!();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(env.id);
  });

  it('throws when storage is not configured', () => {
    const t = new FileTransport();
    expect(() => t.writeInbound!(makeEnvelope())).toThrow(MesaError);
  });

  it('writes use atomic storage (file exists after write)', () => {
    const env = makeEnvelope();
    transport.writeInbound!(env);
    const file = join(testDir, 'inbox', `${env.id}.json`);
    const content = storage.readText(file);
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content!);
    expect(parsed.id).toBe(env.id);
  });
});

// --- Transport Registry ---

describe('transport-registry', () => {
  it('registerTransport adds transport', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    const custom = new FileTransport();
    Object.defineProperty(custom, 'name', { value: 'Custom Transport' });
    registerTransport(ctx, custom);
    expect(listTransports(ctx)).toHaveLength(2);
  });

  it('registerTransport rejects duplicate name', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    expect(() => registerTransport(ctx, new FileTransport())).toThrow(MesaError);
  });

  it('getTransport finds by name', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    const t = getTransport(ctx, 'File Transport');
    expect(t.name).toBe('File Transport');
  });

  it('getTransport throws for unknown name', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    expect(() => getTransport(ctx, 'Ghost')).toThrow(MesaError);
  });

  it('inspectTransport enforces transport.inspect policy', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const { RoleBasedPolicyEngine } = await import('../runtime/policy.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['builder'] },
      policy: new RoleBasedPolicyEngine(),
    });
    expect(() => inspectTransport(ctx, 'File Transport')).toThrow(PolicyDeniedError);
  });

  it('inspectTransport allows owner', async () => {
    const { createRuntimeContext } = await import('../runtime/create-runtime-context.js');
    const ctx = createRuntimeContext({
      rootDir: process.cwd(),
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    const t = inspectTransport(ctx, 'File Transport');
    expect(t.name).toBe('File Transport');
  });
});
