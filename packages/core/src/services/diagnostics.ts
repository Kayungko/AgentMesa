import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MesaEventSchema } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { listEvents } from './event-service.js';
import {
  getTaskProjection,
  getMeetingProjection,
  getAgentProjection,
} from './projection-read-service.js';

export interface DiagnosticFinding {
  level: 'ok' | 'warn' | 'error';
  category: string;
  message: string;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function validateEventLog(eventsDir: string): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const filePath = join(eventsDir, 'events.jsonl');

  if (!existsSync(filePath)) {
    findings.push({ level: 'ok', category: 'events', message: 'No events log yet (empty workspace).' });
    return findings;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let lineNum = 0;
    let validCount = 0;
    let errorCount = 0;

    for (const line of lines) {
      lineNum++;
      if (line === '') continue;

      try {
        const raw = JSON.parse(line);
        const result = MesaEventSchema.safeParse(raw);
        if (result.success) {
          validCount++;
        } else {
          errorCount++;
          const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          findings.push({
            level: 'error',
            category: 'events',
            message: `Line ${lineNum}: invalid event — ${issues}`,
          });
        }
      } catch {
        errorCount++;
        findings.push({
          level: 'error',
          category: 'events',
          message: `Line ${lineNum}: corrupted — not valid JSON (${line.slice(0, 80)}...)`,
        });
      }
    }

    if (errorCount === 0) {
      findings.push({
        level: 'ok',
        category: 'events',
        message: `Event log valid: ${validCount} event(s) across ${lineNum} line(s).`,
      });
    } else {
      findings.push({
        level: 'warn',
        category: 'events',
        message: `${validCount} valid, ${errorCount} invalid event(s) in log.`,
      });
    }
  } catch (err) {
    findings.push({
      level: 'error',
      category: 'events',
      message: `Failed to read event log: ${String(err)}`,
    });
  }

  return findings;
}

export function checkProjectionConsistency(ctx: MesaRuntimeContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  // Check tasks: events exist → projection should exist
  const taskEvents = listEvents(ctx, { streamType: 'task' });
  if (taskEvents.length === 0) return findings;

  const taskStreams = new Set(taskEvents.map((e) => e.streamId));
  let missing = 0;
  let tombstones = 0;
  for (const streamId of taskStreams) {
    const proj = getTaskProjection(ctx, streamId);
    if (!proj) {
      missing++;
      findings.push({
        level: 'warn',
        category: 'projections',
        message: `Task "${streamId}" has events but no projection — run "mesa rebuild".`,
      });
    } else if (proj.deleted === true) {
      tombstones++;
    }
  }

  // Check meetings
  const meetingStreams = new Set(
    listEvents(ctx, { type: 'meeting_created' }).map((e) => e.streamId),
  );
  for (const streamId of meetingStreams) {
    const proj = getMeetingProjection(ctx, streamId);
    if (!proj) {
      missing++;
      findings.push({
        level: 'warn',
        category: 'projections',
        message: `Meeting "${streamId}" has events but no projection — run "mesa rebuild".`,
      });
    }
  }

  // Check agents
  const agentStreams = new Set(
    listEvents(ctx, { type: 'agent_registered' }).map((e) => e.streamId),
  );
  for (const streamId of agentStreams) {
    const proj = getAgentProjection(ctx, streamId);
    if (!proj) {
      missing++;
      findings.push({
        level: 'warn',
        category: 'projections',
        message: `Agent "${streamId}" has events but no projection — run "mesa rebuild".`,
      });
    }
  }

  if (missing === 0) {
    findings.push({
      level: 'ok',
      category: 'projections',
      message: `Projections consistent: ${taskStreams.size} task(s), ${meetingStreams.size} meeting(s), ${agentStreams.size} agent(s). Tombstones: ${tombstones}.`,
    });
  }

  return findings;
}

export function findOrphanedLocks(paths: MesaWorkspacePaths): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const locksDir = paths.locksDir;

  if (!existsSync(locksDir)) return findings;

  const lockFiles = readdirSync(locksDir).filter((f) => f.endsWith('.lock'));
  let orphaned = 0;

  for (const file of lockFiles) {
    const lockPath = join(locksDir, file);
    try {
      const raw = readFileSync(lockPath, 'utf-8');
      const data = JSON.parse(raw) as { pid: number; resource: string; acquiredAt: string };
      if (!pidIsAlive(data.pid)) {
        orphaned++;
        findings.push({
          level: 'warn',
          category: 'locks',
          message: `Orphaned lock for "${data.resource}" (pid ${data.pid} is dead, acquired ${data.acquiredAt}).`,
        });
      }
    } catch {
      findings.push({
        level: 'warn',
        category: 'locks',
        message: `Corrupt lock file: ${file}.`,
      });
      orphaned++;
    }
  }

  if (orphaned === 0 && lockFiles.length > 0) {
    findings.push({
      level: 'ok',
      category: 'locks',
      message: `${lockFiles.length} active lock(s) — no orphans.`,
    });
  } else if (lockFiles.length === 0) {
    findings.push({
      level: 'ok',
      category: 'locks',
      message: 'No lock files found.',
    });
  }

  return findings;
}

export function runAllDiagnostics(ctx: MesaRuntimeContext): DiagnosticFinding[] {
  return [
    ...validateEventLog(ctx.paths.eventsDir),
    ...checkProjectionConsistency(ctx),
    ...findOrphanedLocks(ctx.paths),
  ];
}
