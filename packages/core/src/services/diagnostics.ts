import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MesaEventSchema, TransportEnvelopeSchema } from '@agentmesa/protocol';
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
  path?: string;
  resourceId?: string;
  fixable?: boolean;
  recommendation?: string;
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
            path: filePath,
            recommendation: 'Remove or fix the corrupted line, or delete the events log to start fresh.',
          });
        }
      } catch {
        errorCount++;
        findings.push({
          level: 'error',
          category: 'events',
          message: `Line ${lineNum}: corrupted — not valid JSON (${line.slice(0, 80)}...)`,
          path: filePath,
          recommendation: 'Remove or fix the corrupted line, or delete the events log to start fresh.',
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
  let corrupted = 0;
  let stale = 0;
  let tombstones = 0;

  for (const streamId of taskStreams) {
    try {
      const proj = getTaskProjection(ctx, streamId);
      if (!proj) {
        missing++;
        findings.push({
          level: 'warn',
          category: 'projections',
          message: `Task "${streamId}" has events but no projection — run "mesa rebuild".`,
          resourceId: streamId,
          path: join(ctx.paths.taskProjectionsDir, `${streamId}.json`),
          fixable: true,
          recommendation: 'Run "mesa rebuild" to regenerate this projection.',
        });
        continue;
      }

      if (proj.deleted === true) tombstones++;

      // Staleness: compare _meta.lastSequence vs max event sequence for this stream
      const streamEvents = taskEvents.filter((e) => e.streamId === streamId);
      if (streamEvents.length > 0) {
        const maxSeq = Math.max(...streamEvents.map((e) => e.sequence));
        const metaSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
        if (metaSeq !== undefined && metaSeq < maxSeq) {
          stale++;
          findings.push({
            level: 'warn',
            category: 'projections',
            message: `Task "${streamId}" projection is stale (last event seq ${maxSeq}, projection seq ${metaSeq}) — run "mesa rebuild".`,
            resourceId: streamId,
            path: join(ctx.paths.taskProjectionsDir, `${streamId}.json`),
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate this projection.',
          });
        }
      }
    } catch {
      corrupted++;
      findings.push({
        level: 'error',
        category: 'projections',
        message: `Task "${streamId}" projection is corrupted (invalid JSON or schema) — run "mesa rebuild".`,
        resourceId: streamId,
        path: join(ctx.paths.taskProjectionsDir, `${streamId}.json`),
        fixable: true,
        recommendation: 'Run "mesa rebuild" to regenerate this projection.',
      });
    }
  }

  // Check meetings
  const meetingEvents = listEvents(ctx, { type: 'meeting_created' });
  const meetingStreams = new Set(meetingEvents.map((e) => e.streamId));
  for (const streamId of meetingStreams) {
    try {
      const proj = getMeetingProjection(ctx, streamId);
      if (!proj) {
        missing++;
        findings.push({
          level: 'warn',
          category: 'projections',
          message: `Meeting "${streamId}" has events but no projection — run "mesa rebuild".`,
          resourceId: streamId,
          path: join(ctx.paths.meetingProjectionsDir, `${streamId}.json`),
          fixable: true,
          recommendation: 'Run "mesa rebuild" to regenerate this projection.',
        });
        continue;
      }

      // Staleness
      const streamEvents = listEvents(ctx, { streamId });
      if (streamEvents.length > 0) {
        const maxSeq = Math.max(...streamEvents.map((e) => e.sequence));
        const metaSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
        if (metaSeq !== undefined && metaSeq < maxSeq) {
          stale++;
          findings.push({
            level: 'warn',
            category: 'projections',
            message: `Meeting "${streamId}" projection is stale (last event seq ${maxSeq}, projection seq ${metaSeq}) — run "mesa rebuild".`,
            resourceId: streamId,
            path: join(ctx.paths.meetingProjectionsDir, `${streamId}.json`),
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate this projection.',
          });
        }
      }
    } catch {
      corrupted++;
      findings.push({
        level: 'error',
        category: 'projections',
        message: `Meeting "${streamId}" projection is corrupted (invalid JSON or schema) — run "mesa rebuild".`,
        resourceId: streamId,
        path: join(ctx.paths.meetingProjectionsDir, `${streamId}.json`),
        fixable: true,
        recommendation: 'Run "mesa rebuild" to regenerate this projection.',
      });
    }
  }

  // Check agents
  const agentEvents = listEvents(ctx, { type: 'agent_registered' });
  const agentStreams = new Set(agentEvents.map((e) => e.streamId));
  for (const streamId of agentStreams) {
    try {
      const proj = getAgentProjection(ctx, streamId);
      if (!proj) {
        missing++;
        findings.push({
          level: 'warn',
          category: 'projections',
          message: `Agent "${streamId}" has events but no projection — run "mesa rebuild".`,
          resourceId: streamId,
          path: join(ctx.paths.agentProjectionsDir, `${streamId}.json`),
          fixable: true,
          recommendation: 'Run "mesa rebuild" to regenerate this projection.',
        });
        continue;
      }

      // Staleness
      const streamEvents = listEvents(ctx, { streamId });
      if (streamEvents.length > 0) {
        const maxSeq = Math.max(...streamEvents.map((e) => e.sequence));
        const metaSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
        if (metaSeq !== undefined && metaSeq < maxSeq) {
          stale++;
          findings.push({
            level: 'warn',
            category: 'projections',
            message: `Agent "${streamId}" projection is stale (last event seq ${maxSeq}, projection seq ${metaSeq}) — run "mesa rebuild".`,
            resourceId: streamId,
            path: join(ctx.paths.agentProjectionsDir, `${streamId}.json`),
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate this projection.',
          });
        }
      }
    } catch {
      corrupted++;
      findings.push({
        level: 'error',
        category: 'projections',
        message: `Agent "${streamId}" projection is corrupted (invalid JSON or schema) — run "mesa rebuild".`,
        resourceId: streamId,
        path: join(ctx.paths.agentProjectionsDir, `${streamId}.json`),
        fixable: true,
        recommendation: 'Run "mesa rebuild" to regenerate this projection.',
      });
    }
  }

  if (missing === 0 && corrupted === 0 && stale === 0) {
    findings.push({
      level: 'ok',
      category: 'projections',
      message: `Projections consistent: ${taskStreams.size} task(s), ${meetingStreams.size} meeting(s), ${agentStreams.size} agent(s). Tombstones: ${tombstones}.`,
    });
  } else {
    const parts: string[] = [];
    if (missing > 0) parts.push(`${missing} missing`);
    if (corrupted > 0) parts.push(`${corrupted} corrupted`);
    if (stale > 0) parts.push(`${stale} stale`);
    findings.push({
      level: corrupted > 0 ? 'error' : 'warn',
      category: 'projections',
      message: `Projection issues: ${parts.join(', ')}.`,
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
          path: lockPath,
          fixable: true,
          recommendation: 'Run "mesa doctor --fix" to remove orphaned lock files.',
        });
      }
    } catch {
      findings.push({
        level: 'warn',
        category: 'locks',
        message: `Corrupt lock file: ${file}.`,
        path: lockPath,
        fixable: true,
        recommendation: 'Run "mesa doctor --fix" to remove corrupt lock files.',
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

export function checkTransportEnvelopes(ctx: MesaRuntimeContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const dirs: Array<{ dir: string; label: string }> = [];

  if (existsSync(ctx.paths.inboxDir)) {
    dirs.push({ dir: ctx.paths.inboxDir, label: 'inbox' });
  }
  if (existsSync(ctx.paths.outboxDir)) {
    dirs.push({ dir: ctx.paths.outboxDir, label: 'outbox' });
  }

  if (dirs.length === 0) {
    findings.push({ level: 'ok', category: 'transport', message: 'No transport envelope directories.' });
    return findings;
  }

  let totalValid = 0;
  let totalCorrupted = 0;

  for (const { dir, label } of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let valid = 0;
    let corrupted = 0;

    const expectedDirection = label === 'inbox' ? 'inbound' : 'outbound';

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const json = JSON.parse(raw);
        const result = TransportEnvelopeSchema.safeParse(json);
        if (result.success) {
          const env = result.data;
          if (env.direction !== expectedDirection) {
            corrupted++;
            findings.push({
              level: 'error',
              category: 'transport',
              message: `Misdirected ${label} envelope "${file}": direction is "${env.direction}", expected "${expectedDirection}"`,
              path: filePath,
              resourceId: env.id,
              fixable: false,
              recommendation: 'Move the envelope to the correct mailbox or fix its direction',
            });
          } else {
            valid++;
          }
        } else {
          corrupted++;
          const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          findings.push({
            level: 'error',
            category: 'transport',
            message: `Corrupted ${label} envelope "${file}": ${issues}`,
            path: filePath,
            fixable: false,
            recommendation: 'Remove or repair corrupted transport envelope',
          });
        }
      } catch {
        corrupted++;
        findings.push({
          level: 'error',
          category: 'transport',
          message: `Corrupted ${label} envelope "${file}": not valid JSON`,
          path: filePath,
          fixable: false,
          recommendation: 'Remove or repair corrupted transport envelope',
        });
      }
    }

    totalValid += valid;
    totalCorrupted += corrupted;
  }

  if (totalCorrupted === 0) {
    findings.push({
      level: 'ok',
      category: 'transport',
      message: `Transport envelopes valid: ${totalValid} envelope(s).`,
    });
  } else {
    findings.push({
      level: 'warn',
      category: 'transport',
      message: `${totalValid} valid, ${totalCorrupted} corrupted transport envelope(s).`,
    });
  }

  return findings;
}

export function runAllDiagnostics(ctx: MesaRuntimeContext): DiagnosticFinding[] {
  return [
    ...validateEventLog(ctx.paths.eventsDir),
    ...checkProjectionConsistency(ctx),
    ...checkTransportEnvelopes(ctx),
    ...findOrphanedLocks(ctx.paths),
  ];
}
