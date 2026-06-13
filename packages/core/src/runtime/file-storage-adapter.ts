import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { MesaError } from '../errors.js';
import type { MesaStorageAdapter } from './types.js';

/** Suffix marking in-flight temp files an atomic write may leave behind on crash. */
export const TEMP_FILE_MARKER = '.mesa-tmp-';

let tempCounter = 0;

export class FileStorageAdapter implements MesaStorageAdapter {
  readText(path: string): string | null {
    if (!existsSync(path)) {
      return null;
    }

    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new MesaError('STORAGE_ERROR', `Failed to read ${path}: ${String(error)}`);
    }
  }

  writeText(path: string, content: string): void {
    try {
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true });
      // Atomic write: fully write + flush a temp file, then rename it into place.
      // A reader never sees a partially written file, and a crash mid-write leaves
      // an orphaned temp file rather than a corrupt target. rename is atomic on the
      // same filesystem (Windows uses MoveFileEx with REPLACE_EXISTING).
      const tempPath = join(dir, `${TEMP_FILE_MARKER}${process.pid}-${tempCounter++}`);
      const fd = openSync(tempPath, 'w');
      try {
        writeSync(fd, content, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        renameSync(tempPath, path);
      } catch (renameError) {
        try {
          unlinkSync(tempPath);
        } catch {
          // best-effort cleanup; surface the original rename failure below
        }
        throw renameError;
      }
    } catch (error) {
      throw new MesaError('STORAGE_ERROR', `Failed to write ${path}: ${String(error)}`);
    }
  }

  delete(path: string): boolean {
    if (!existsSync(path)) {
      return false;
    }

    try {
      unlinkSync(path);
      return true;
    } catch (error) {
      throw new MesaError('STORAGE_ERROR', `Failed to delete ${path}: ${String(error)}`);
    }
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  list(path: string): string[] {
    if (!existsSync(path)) {
      return [];
    }

    try {
      // Hide orphaned temp files so a crashed write is never read as a record.
      return readdirSync(path).filter((name) => !name.startsWith(TEMP_FILE_MARKER));
    } catch (error) {
      throw new MesaError('STORAGE_ERROR', `Failed to list ${path}: ${String(error)}`);
    }
  }

  ensureDirectory(path: string): void {
    try {
      mkdirSync(path, { recursive: true });
    } catch (error) {
      throw new MesaError('STORAGE_ERROR', `Failed to create directory ${path}: ${String(error)}`);
    }
  }
}

/**
 * Remove orphaned atomic-write temp files left behind by a crash mid-write.
 * Returns the number of files removed. Used by `mesa doctor` as a diagnostic.
 */
export function cleanOrphanedTempFiles(dirs: string[]): number {
  let removed = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(TEMP_FILE_MARKER)) {
        try {
          unlinkSync(join(dir, name));
          removed++;
        } catch {
          // leave it for the next run if it cannot be removed now
        }
      }
    }
  }
  return removed;
}
