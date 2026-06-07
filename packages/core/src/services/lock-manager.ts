import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import type { MesaWorkspacePaths } from '../workspace.js';
import { ensureDir } from '../storage.js';
import { LockError } from '../errors.js';

interface LockData {
  resource: string;
  pid: number;
  acquiredAt: string;
}

export function acquireLock(paths: MesaWorkspacePaths, resource: string): void {
  ensureDir(paths.locksDir);
  const lockPath = join(paths.locksDir, `${resource}.lock`);

  if (existsSync(lockPath)) {
    try {
      const data = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockData;
      throw new LockError(resource, `already locked by pid ${data.pid} since ${data.acquiredAt}`);
    } catch (err) {
      if (err instanceof LockError) throw err;
      throw new LockError(resource, 'lock file is corrupted');
    }
  }

  const lockData: LockData = {
    resource,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf-8');
}

export function releaseLock(paths: MesaWorkspacePaths, resource: string): void {
  const lockPath = join(paths.locksDir, `${resource}.lock`);

  if (!existsSync(lockPath)) {
    return;
  }

  try {
    unlinkSync(lockPath);
  } catch {
    throw new LockError(resource, 'failed to release lock');
  }
}

export function isLocked(paths: MesaWorkspacePaths, resource: string): boolean {
  const lockPath = join(paths.locksDir, `${resource}.lock`);
  return existsSync(lockPath);
}
