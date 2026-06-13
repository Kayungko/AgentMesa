import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { acquireLock, releaseLock, isLocked, withLock } from '../services/lock-manager.js';
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
    acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);
  });

  it('throws when lock already held', () => {
    acquireLock(ctx, 'task-T-0001');
    expect(() => acquireLock(ctx, 'task-T-0001')).toThrow(LockError);
  });
});

describe('releaseLock', () => {
  it('releases an acquired lock', () => {
    acquireLock(ctx, 'task-T-0001');
    releaseLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });

  it('does not throw when releasing non-existent lock', () => {
    expect(() => releaseLock(ctx, 'non-existent')).not.toThrow();
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
    acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);

    releaseLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);

    acquireLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(true);

    releaseLock(ctx, 'task-T-0001');
    expect(isLocked(ctx, 'task-T-0001')).toBe(false);
  });
});

describe('resource filename safety', () => {
  it.each(['task:T-0001', 'meeting/abc', 'a*b?c', '../escape'])(
    'locks resources with unsafe chars: %s',
    (resource) => {
      acquireLock(ctx, resource);
      expect(isLocked(ctx, resource)).toBe(true);

      const lockFiles = readdirSync(ctx.paths.locksDir);
      expect(lockFiles).toHaveLength(1);
      // The on-disk name must contain none of the unsafe chars and must not
      // escape the locks directory.
      expect(lockFiles[0]).toMatch(/^[0-9a-f]{64}\.lock$/);

      releaseLock(ctx, resource);
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
