import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileStorageAdapter,
  TEMP_FILE_MARKER,
  cleanOrphanedTempFiles,
} from '../runtime/file-storage-adapter.js';

let testDir: string;
let storage: FileStorageAdapter;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-storage-'));
  storage = new FileStorageAdapter();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('FileStorageAdapter.writeText', () => {
  it('writes and reads back content', () => {
    const path = join(testDir, 'sub', 'a.json');
    storage.writeText(path, '{"a":1}');
    expect(storage.readText(path)).toBe('{"a":1}');
  });

  it('atomically overwrites an existing file', () => {
    const path = join(testDir, 'a.json');
    storage.writeText(path, 'first');
    storage.writeText(path, 'second');
    expect(storage.readText(path)).toBe('second');
  });

  it('leaves no temp file behind after a successful write', () => {
    const path = join(testDir, 'a.json');
    storage.writeText(path, 'content');
    const leftovers = readdirSync(testDir).filter((n) => n.startsWith(TEMP_FILE_MARKER));
    expect(leftovers).toEqual([]);
  });
});

describe('FileStorageAdapter.list', () => {
  it('hides orphaned temp files', () => {
    storage.writeText(join(testDir, 'real.json'), '{}');
    writeFileSync(join(testDir, `${TEMP_FILE_MARKER}999-0`), 'partial');
    expect(storage.list(testDir)).toEqual(['real.json']);
  });
});

describe('cleanOrphanedTempFiles', () => {
  it('removes temp files and returns the count', () => {
    writeFileSync(join(testDir, `${TEMP_FILE_MARKER}1-0`), 'x');
    writeFileSync(join(testDir, `${TEMP_FILE_MARKER}1-1`), 'y');
    storage.writeText(join(testDir, 'keep.json'), '{}');

    const removed = cleanOrphanedTempFiles([testDir]);
    expect(removed).toBe(2);
    expect(storage.list(testDir)).toEqual(['keep.json']);
  });

  it('skips directories that do not exist', () => {
    expect(cleanOrphanedTempFiles([join(testDir, 'missing')])).toBe(0);
  });
});
