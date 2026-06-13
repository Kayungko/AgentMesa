import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { LockError } from '../errors.js';

interface LockData {
  resource: string;
  pid: number;
  acquiredAt: string;
}

function lockPathFor(ctx: MesaRuntimeContext, resource: string): string {
  // Hash the resource into the filename: a resource id may contain ':', '/', or
  // Windows-illegal chars like '*', and a raw id could also escape locksDir via
  // path traversal. A sha256 hex digest is collision-resistant, fixed-length,
  // and safe on every filesystem. The original resource lives in the lock body.
  const safeName = createHash('sha256').update(resource).digest('hex');
  return join(ctx.paths.locksDir, `${safeName}.lock`);
}

export function acquireLock(ctx: MesaRuntimeContext, resource: string): void {
  ctx.storage.ensureDirectory(ctx.paths.locksDir);
  const lockPath = lockPathFor(ctx, resource);

  const lockData: LockData = {
    resource,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  try {
    // `wx` fails if the file already exists, making lock creation atomic and
    // free of the check-then-write race a plain existsSync + write would have.
    writeFileSync(lockPath, JSON.stringify(lockData, null, 2), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new LockError(resource, 'failed to acquire lock');
    }
    let heldBy = 'an unknown holder';
    try {
      const data = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockData;
      heldBy = `pid ${data.pid} since ${data.acquiredAt}`;
    } catch {
      throw new LockError(resource, 'lock file is corrupted');
    }
    throw new LockError(resource, `already locked by ${heldBy}`);
  }
}

export function releaseLock(ctx: MesaRuntimeContext, resource: string): void {
  const lockPath = lockPathFor(ctx, resource);

  if (!existsSync(lockPath)) {
    return;
  }

  try {
    unlinkSync(lockPath);
  } catch {
    throw new LockError(resource, 'failed to release lock');
  }
}

export function isLocked(ctx: MesaRuntimeContext, resource: string): boolean {
  return existsSync(lockPathFor(ctx, resource));
}

/**
 * Run `fn` while holding the lock for `resource`, releasing it even if `fn`
 * throws. This is the entry point mutation paths (e.g. event append) should use
 * so a lock is never leaked on failure.
 */
export function withLock<T>(ctx: MesaRuntimeContext, resource: string, fn: () => T): T {
  acquireLock(ctx, resource);
  try {
    return fn();
  } finally {
    releaseLock(ctx, resource);
  }
}
