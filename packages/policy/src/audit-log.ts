import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { AuditEntry } from './types.js';

export class AuditLog {
  private readonly logPath: string;
  private readonly logsDir: string;

  constructor(paths: MesaWorkspacePaths) {
    this.logsDir = paths.logsDir;
    this.logPath = join(paths.logsDir, 'audit.jsonl');
  }

  log(entry: Omit<AuditEntry, 'timestamp'>): void {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
  }

  getEntries(filter?: { agentId?: string; action?: string; since?: string }): AuditEntry[] {
    if (!existsSync(this.logPath)) {
      return [];
    }

    const raw = readFileSync(this.logPath, 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);

    let entries: AuditEntry[] = lines.map((line) => JSON.parse(line) as AuditEntry);

    if (filter?.agentId) {
      entries = entries.filter((e) => e.agentId === filter.agentId);
    }

    if (filter?.action) {
      entries = entries.filter((e) => e.action === filter.action);
    }

    if (filter?.since) {
      const sinceDate = new Date(filter.since).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
    }

    return entries;
  }

  getRecentEntries(n: number = 10): AuditEntry[] {
    if (!existsSync(this.logPath)) {
      return [];
    }

    const raw = readFileSync(this.logPath, 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    const entries = lines.map((line) => JSON.parse(line) as AuditEntry);

    return entries.slice(-n);
  }
}
