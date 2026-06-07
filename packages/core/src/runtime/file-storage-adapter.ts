import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { MesaError } from '../errors.js';
import type { MesaStorageAdapter } from './types.js';

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
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
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
      return readdirSync(path);
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
