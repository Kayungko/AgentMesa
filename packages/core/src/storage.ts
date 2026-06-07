import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { MesaError } from './errors.js';

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new MesaError('STORAGE_ERROR', `Failed to read JSON from ${filePath}: ${err}`);
  }
}

export function writeJson<T>(filePath: string, data: T): void {
  try {
    const sep = filePath.includes('\\') ? '\\' : '/';
    const lastSep = filePath.lastIndexOf(sep);
    const dir = lastSep > 0 ? filePath.substring(0, lastSep) : '';
    if (dir) ensureDir(dir);
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    if (err instanceof MesaError) throw err;
    throw new MesaError('STORAGE_ERROR', `Failed to write JSON to ${filePath}: ${err}`);
  }
}

export function listJson<T>(dirPath: string): T[] {
  if (!existsSync(dirPath)) {
    return [];
  }
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => readJson<T>(join(dirPath, f)))
    .filter((item): item is T => item !== null);
}

export function deleteFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
