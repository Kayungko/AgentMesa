import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { acquireLock, releaseLock, releaseLockUnsafe, isLocked, withLock } from '../services/lock-manager.js';
import { LockError } from '../errors.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('acquires a lock', () => {
    const token = acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('throws when lock already held', () => {
    acquireLock(ctx, 'task-T-0001');
    expect(() => acquireLock(ctx, 'task-T-0001')).toThrow(LockError);
  });
});

describe('releaseLock', () => {
  it('releases an acquired lock', () => {
    const token = acquireLock(ctx, 'task-T-0001');
    releaseLock(ctx, 'task-T-0001', token);
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });

  it('does not throw when releasing non-existent lock', () => {
    expect(() => releaseLock(ctx, 'non-existent', 'fake-token')).not.toThrow();
  });

  it('throws when token does not match', () => {
    acquireLock(ctx, 'task-T-0001');
    expect(() => releaseLock(ctx, 'task-T-0001', 'wrong-token')).toThrow(LockError);
    expect(() => releaseLock(ctx, 'task-T-0001', 'wrong-token')).toThrow('token mismatch');
  });
});

describe('releaseLockUnsafe', () => {
  it('releases a lock without token validation', () => {
    acquireLock(ctx, 'task-T-0001');
    releaseLockUnsafe(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });

  it('allows re-acquire after unsafe release', () => {
    acquireLock(ctx, 'task-T-0001');
    releaseLockUnsafe(ctx, 'task-T-0001');
    const token = acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);
    expect(token).toBeDefined();
  });
});

describe('isLocked', () => {
  it('returns false for unlocked resource', () => {
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });

  it('returns true for locked resource', () => {
    acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);
  });
});

describe('lock lifecycle', () => {
  it('supports acquire -> release -> acquire cycle', () => {
    const t1 = acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);

    releaseLock(ctx, 'task-T-0001', t1);
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);

    const t2 = acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);

    releaseLock(ctx, 'task-T-0001', t2);
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });
});

describe('resource filename safety', () => {
  it.each(['task:T-0001', 'meeting/abc', 'a*b?c', '../escape'])(
    'locks resources with unsafe chars: %s',
    (resource) => {
      const token = acquireLock(ctx, resource);
      expect(isLocked(ctx, resource)).toBe(true);

      const lockFiles = readdirSync(ctx.paths.locksDir);
      expect(lockFiles).toHaveLength(1);
      // The on-disk name must contain none of the unsafe chars and must not
      // escape the locks directory.
      expect(lockFiles[0]).toMatch(/^[0-9a-f]{64}\.lock$/);

      releaseLock(ctx, resource, token);
      expect(isLocked(ctx, resource)).toBe(false);
      expect(readdirSync(ctx.paths.locksDir)).toHaveLength(0);
    },
  );

  it('maps distinct resources to distinct lock files', () => {
    acquireLock(ctx, 'task:T-0001');
    acquireLock(ctx, 'meeting/abc');
    expect(readdirSync(ctx.paths.locksDir)).toHaveLength(2);
  });
});

describe('withLock', () => {
  it('holds the lock during the callback and releases it after', () => {
    const result = withLock(ctx, 'task-T-0001', () => {
      expect(isLocked(ctx, 'task-T-0001')).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });

  it('releases the lock even when the callback throws', () => {
    expect(() =>
      withLock(ctx, 'task-T-0001', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });
});

describe('lock token', () => {
  it('includes a unique UUID token in each lock', () => {
    const token = acquireLock(ctx, 'token-test');
    expect(isLocked(ctx, 'token-test')).toBe(true);
    expect(token).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 pattern

    const lockFiles = readdirSync(ctx.paths.locksDir).filter((f) => f.endsWith('.lock'));
    expect(lockFiles).toHaveLength(1);

    const content = readFileSync(join(ctx.paths.locksDir, lockFiles[0]!), 'utf-8');
    const data = JSON.parse(content);
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
    expect(data.token).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 pattern
    expect(data.token).toBe(token); // returned token matches stored token

    releaseLock(ctx, 'token-test', token);
  });

  it('generates different tokens for different locks', () => {
    const t1 = acquireLock(ctx, 'token-a');
    const filesA = readdirSync(ctx.paths.locksDir).filter((f) => f.endsWith('.lock'));
    const dataA = JSON.parse(readFileSync(join(ctx.paths.locksDir, filesA[0]!), 'utf-8'));
    releaseLock(ctx, 'token-a', t1);

    const t2 = acquireLock(ctx, 'token-b');
    const filesB = readdirSync(ctx.paths.locksDir).filter((f) => f.endsWith('.lock'));
    const dataB = JSON.parse(readFileSync(join(ctx.paths.locksDir, filesB[0]!), 'utf-8'));
    releaseLock(ctx, 'token-b', t2);

    expect(dataA.token).not.toBe(dataB.token);
  });

  it('withLock token flow is correct', () => {
    const result = withLock(ctx, 'wl-token-test', () => {
      expect(isLocked(ctx, 'wl-token-test')).toBe(true);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(isLocked(ctx, 'wl-token-test')).toBe(false);
    // After withLock releases normally, a fresh acquire should succeed
    const token = acquireLock(ctx, 'wl-token-test');
    expect(isLocked(ctx, 'wl-token-test')).toBe(true);
    releaseLock(ctx, 'wl-token-test', token);
  });
});
