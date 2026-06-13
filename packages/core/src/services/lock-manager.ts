import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { LockError } from '../errors.js';

interface LockData {
  resource: string;
  pid: number;
  token: string;
  acquiredAt: string;
}

export interface AcquireLockOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait is acceptable here because lock contention is a short-lived,
    // low-frequency operation and Node.js has no cross-platform synchronous sleep.
  }
}

function lockPathFor(ctx: MesaRuntimeContext, resource: string): string {
  // Hash the resource into the filename: a resource id may contain ':', '/', or
  // Windows-illegal chars like '*', and a raw id could also escape locksDir via
  // path traversal. A sha256 hex digest is collision-resistant, fixed-length,
  // and safe on every filesystem. The original resource lives in the lock body.
  const safeName = createHash('sha256').update(resource).digest('hex');
  return join(ctx.paths.locksDir, `${safeName}.lock`);
}

export function acquireLock(
  ctx: MesaRuntimeContext,
  resource: string,
  options?: AcquireLockOptions,
): string {
  ctx.storage.ensureDirectory(ctx.paths.locksDir);
  const lockPath = lockPathFor(ctx, resource);

  const timeoutMs = options?.timeoutMs ?? 0;
  const retryIntervalMs = options?.retryIntervalMs ?? 100;

  const lockData: LockData = {
    resource,
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };

  const startedAt = Date.now();

  while (true) {
    try {
      writeFileSync(lockPath, JSON.stringify(lockData, null, 2), { encoding: 'utf-8', flag: 'wx' });
      return lockData.token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new LockError(resource, 'failed to acquire lock');
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        let heldBy = 'an unknown holder';
        try {
          const data = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockData;
          heldBy = `pid ${data.pid} since ${data.acquiredAt}`;
        } catch {
          throw new LockError(resource, 'lock file is corrupted');
        }
        throw new LockError(resource, `timed out after ${timeoutMs}ms — already locked by ${heldBy}`);
      }

      sleepSync(retryIntervalMs);
    }
  }
}

export function releaseLock(ctx: MesaRuntimeContext, resource: string, token: string): void {
  const lockPath = lockPathFor(ctx, resource);

  if (!existsSync(lockPath)) {
    return;
  }

  const data = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockData;
  if (data.token !== token) {
    throw new LockError(resource, 'token mismatch: lock held by different caller');
  }

  try {
    unlinkSync(lockPath);
  } catch {
    throw new LockError(resource, 'failed to release lock');
  }
}

export function releaseLockUnsafe(ctx: MesaRuntimeContext, resource: string): void {
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
export function withLock<T>(
  ctx: MesaRuntimeContext,
  resource: string,
  fn: () => T,
  options?: AcquireLockOptions,
): T {
  const token = acquireLock(ctx, resource, options);
  try {
    return fn();
  } finally {
    releaseLock(ctx, resource, token);
  }
}
