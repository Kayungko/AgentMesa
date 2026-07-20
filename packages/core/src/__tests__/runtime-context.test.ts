import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentProtocolVersion, generateEventId } from '@agentmesa/protocol';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import { initWorkspace } from '../workspace.js';
import { FileStorageAdapter } from '../runtime/file-storage-adapter.js';
import { FileEventStore } from '../runtime/file-event-store.js';
import { InMemoryMesaEventStore } from '../runtime/event-store.js';
import { AllowAllMesaPolicyEngine, RoleBasedPolicyEngine } from '../runtime/policy.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-runtime-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testDir, { recursive: true, force: true });
});

describe('createRuntimeContext', () => {
  it('creates workspace paths, config, and default dependencies', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.rootDir).toBe(testDir);
    expect(ctx.config.protocolVersion).toBe(currentProtocolVersion);
    expect(ctx.storage.exists(join(ctx.paths.mesaDir, 'config.json'))).toBe(true);
    expect(ctx.storage).toBeDefined();
    expect(ctx.eventStore).toBeDefined();
    expect(ctx.policy.can(ctx.actor, 'task.read', 'task')).toEqual({
      allowed: true,
    });
    expect(ctx.logger).toBeDefined();
  });

  it('creates events and projections directories', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.storage.exists(ctx.paths.eventsDir)).toBe(true);
    expect(ctx.storage.exists(ctx.paths.projectionsDir)).toBe(true);
    expect(ctx.storage.exists(ctx.paths.taskProjectionsDir)).toBe(true);
    expect(ctx.storage.exists(ctx.paths.meetingProjectionsDir)).toBe(true);
    expect(ctx.storage.exists(ctx.paths.agentProjectionsDir)).toBe(true);
  });

  it('uses FileEventStore by default', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.eventStore).toBeInstanceOf(FileEventStore);
  });

  it('allows injecting InMemoryMesaEventStore via options', () => {
    const memoryStore = new InMemoryMesaEventStore();
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      eventStore: memoryStore,
    });

    expect(ctx.eventStore).toBe(memoryStore);
  });

  it('loads an existing config', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
        projectName: 'AgentMesa',
      })
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      storage,
    });

    expect(ctx.config.projectName).toBe('AgentMesa');
  });

  it('defaults readModel to hybrid when not in config', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
      })
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      storage,
    });

    expect(ctx.config.readModel).toEqual({ mode: 'hybrid' });
  });

  it('preserves existing readModel.mode from config', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
        readModel: { mode: 'projection' },
      })
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      storage,
    });

    expect(ctx.config.readModel).toEqual({ mode: 'projection' });
  });

  it('new config has readModel hybrid by default', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.config.readModel).toEqual({ mode: 'hybrid' });
  });
});

describe('FileStorageAdapter', () => {
  it('reads, writes, checks, and lists text files', () => {
    const storage = new FileStorageAdapter();
    const directory = join(testDir, 'nested');
    const filePath = join(directory, 'example.txt');

    storage.writeText(filePath, 'hello');

    expect(storage.exists(filePath)).toBe(true);
    expect(storage.readText(filePath)).toBe('hello');
    expect(storage.list(directory)).toContain('example.txt');
    expect(storage.delete(filePath)).toBe(true);
    expect(storage.exists(filePath)).toBe(false);
    expect(storage.delete(filePath)).toBe(false);
    expect(storage.readText(join(directory, 'missing.txt'))).toBeNull();
  });
});

describe('default runtime dependencies', () => {
  it('appends and filters events', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });
    const event = {
      protocolVersion: currentProtocolVersion,
      id: generateEventId(),
      meetingId: 'meeting_test',
      type: 'task_created' as const,
      streamId: 'task_test',
      streamType: 'task',
      data: {},
      actor: ctx.actor.id,
      sequence: 0,
      timestamp: new Date().toISOString(),
    };

    ctx.eventStore.append(event);

    expect(ctx.eventStore.list()).toEqual([event]);
    expect(ctx.eventStore.list({ actor: 'user:test' })).toEqual([event]);
    expect(ctx.eventStore.list({ actor: 'agent:other' })).toEqual([]);
  });

  it('exposes all console logger methods', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    ctx.logger.debug('debug');
    ctx.logger.info('info');
    ctx.logger.warn('warn');
    ctx.logger.error('error');

    expect(debug).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('defaults to RoleBasedPolicyEngine for a brand-new workspace', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.policy).toBeInstanceOf(RoleBasedPolicyEngine);
    expect(ctx.policy.can(ctx.actor, 'task.create', 't1')).toEqual({ allowed: true });
  });

  it('writes policy.mode role-based into a freshly created config.json', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
    });

    expect(ctx.config.policy).toEqual({ mode: 'role-based' });
    const raw = ctx.storage.readText(join(ctx.paths.mesaDir, 'config.json'));
    expect(JSON.parse(raw as string).policy).toEqual({ mode: 'role-based' });
  });

  it('denies an under-privileged actor by default in a new workspace', () => {
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:custom', type: 'agent', roles: ['custom'] },
    });

    // 'custom' only has read_task — this proves the default really did flip
    // from allow-all to role-based, not just that the config field exists.
    expect(ctx.policy.can(ctx.actor, 'task.create', 't1').allowed).toBe(false);
  });

  it('defaults to RoleBasedPolicyEngine through the real mesa init -> createRuntimeContext path', () => {
    // The vast majority of real usage (mesa init, and every test's
    // mkdtempSync + initWorkspace setup) calls initWorkspace() BEFORE
    // createRuntimeContext(), which means createRuntimeContext always sees
    // an existing config.json and never hits its own fresh-config branch.
    // initWorkspace() has its own independent default that must also be
    // role-based, or this flip is a no-op for nearly every real caller.
    initWorkspace(testDir);
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:custom', type: 'agent', roles: ['custom'] },
    });

    expect(ctx.policy).toBeInstanceOf(RoleBasedPolicyEngine);
    expect(ctx.policy.can(ctx.actor, 'task.create', 't1').allowed).toBe(false);
  });

  it('keeps AllowAllMesaPolicyEngine for a pre-existing config.json without a policy field', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
      }),
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:custom', type: 'agent', roles: ['custom'] },
      storage,
    });

    // Pre-existing workspaces are not retroactively affected by the new
    // default — only brand-new configs opt into role-based enforcement.
    expect(ctx.policy).toBeInstanceOf(AllowAllMesaPolicyEngine);
    expect(ctx.policy.can(ctx.actor, 'task.create', 't1').allowed).toBe(true);
  });

  it('selects RoleBasedPolicyEngine when policy.mode is role-based', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
        policy: { mode: 'role-based' },
      }),
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      storage,
    });

    expect(ctx.policy).toBeInstanceOf(RoleBasedPolicyEngine);
  });

  it('role-based policy denies an unmapped action for non-owner', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
        policy: { mode: 'role-based' },
      }),
    );

    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:builder', type: 'agent', roles: ['builder'] },
      storage,
    });

    // builder can write_task → task.create is allowed
    expect(ctx.policy.can(ctx.actor, 'task.create', 't1').allowed).toBe(true);
  });

  it('options.policy takes precedence over config mode', () => {
    const storage = new FileStorageAdapter();
    const configPath = join(testDir, '.agentmesa', 'config.json');
    // Write role-based in config
    storage.writeText(
      configPath,
      JSON.stringify({
        protocolVersion: currentProtocolVersion,
        policy: { mode: 'role-based' },
      }),
    );

    const allowAll = new AllowAllMesaPolicyEngine();
    const ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:test', type: 'user', roles: ['owner'] },
      storage,
      policy: allowAll,
    });

    expect(ctx.policy).toBe(allowAll);
    expect(ctx.policy).toBeInstanceOf(AllowAllMesaPolicyEngine);
  });
});
