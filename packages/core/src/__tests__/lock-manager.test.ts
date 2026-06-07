import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { acquireLock, releaseLock, isLocked } from '../services/lock-manager.js';
import { LockError } from '../errors.js';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('acquires a lock', () => {
    acquireLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(true);
  });

  it('throws when lock already held', () => {
    acquireLock(paths, 'task-T-0001');
    expect(() => acquireLock(paths, 'task-T-0001')).toThrow(LockError);
  });
});

describe('releaseLock', () => {
  it('releases an acquired lock', () => {
    acquireLock(paths, 'task-T-0001');
    releaseLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(false);
  });

  it('does not throw when releasing non-existent lock', () => {
    expect(() => releaseLock(paths, 'non-existent')).not.toThrow();
  });
});

describe('isLocked', () => {
  it('returns false for unlocked resource', () => {
    expect(isLocked(paths, 'task-T-0001')).toBe(false);
  });

  it('returns true for locked resource', () => {
    acquireLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(true);
  });
});

describe('lock lifecycle', () => {
  it('supports acquire -> release -> acquire cycle', () => {
    acquireLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(true);

    releaseLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(false);

    acquireLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(true);

    releaseLock(paths, 'task-T-0001');
    expect(isLocked(paths, 'task-T-0001')).toBe(false);
  });
});
