import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createTask, deleteTask, updateTaskStatus } from '../services/task-service.js';
import { createMeeting } from '../services/meeting-service.js';
import { registerAgent } from '../services/agent-registry.js';
import { rebuildAllProjections } from '../services/projection-service.js';
import {
  validateEventLog,
  checkProjectionConsistency,
  findOrphanedLocks,
  checkAgentRunConsistency,
  runAllDiagnostics,
} from '../services/diagnostics.js';
import type { DiagnosticFinding } from '../services/diagnostics.js';
import { createAgentRun } from '../services/agent-run-service.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-diag-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('validateEventLog', () => {
  it('returns ok for empty workspace (no events.jsonl)', () => {
    const findings = validateEventLog(paths.eventsDir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('ok');
    expect(findings[0]?.message).toContain('No events log');
  });

  it('validates a healthy event log', () => {
    createTask(ctx, { title: 'Health check' });
    const findings = validateEventLog(paths.eventsDir);
    const ok = findings.filter((f) => f.level === 'ok');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok[0]?.message).toContain('Event log valid');
  });

  it('detects corrupted JSON in event log', () => {
    const eventsPath = join(paths.eventsDir, 'events.jsonl');
    writeFileSync(eventsPath, '{not valid json\n', 'utf-8');
    const findings = validateEventLog(paths.eventsDir);
    const errors = findings.filter((f) => f.level === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain('corrupted');
  });

  it('detects invalid event schema', () => {
    const eventsPath = join(paths.eventsDir, 'events.jsonl');
    writeFileSync(eventsPath, '{"id":"e_1","type":"bogus_type","streamId":"s1","data":{},"actor":"a","timestamp":"2024-01-01T00:00:00.000Z","sequence":0}\n', 'utf-8');
    const findings = validateEventLog(paths.eventsDir);
    const errors = findings.filter((f) => f.level === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain('invalid event');
  });

  it('includes path and recommendation on corrupt JSON finding', () => {
    const eventsPath = join(paths.eventsDir, 'events.jsonl');
    writeFileSync(eventsPath, '{not valid json\n', 'utf-8');
    const findings = validateEventLog(paths.eventsDir);
    const corrupt = findings.find((f) => f.message.includes('corrupted'));
    expect(corrupt).toBeDefined();
    expect(corrupt!.path).toBe(eventsPath);
    expect(corrupt!.recommendation).toContain('Remove or fix');
  });

  it('includes path and recommendation on invalid event finding', () => {
    const eventsPath = join(paths.eventsDir, 'events.jsonl');
    writeFileSync(eventsPath, '{"id":"e_1","type":"bogus_type","streamId":"s1","data":{},"actor":"a","timestamp":"2024-01-01T00:00:00.000Z","sequence":0}\n', 'utf-8');
    const findings = validateEventLog(paths.eventsDir);
    const invalid = findings.find((f) => f.message.includes('invalid event'));
    expect(invalid).toBeDefined();
    expect(invalid!.path).toBe(eventsPath);
    expect(invalid!.recommendation).toContain('Remove or fix');
  });
});

describe('checkProjectionConsistency', () => {
  it('returns empty ok when there are no events', () => {
    const findings = checkProjectionConsistency(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe('ok');
    expect(findings[0]!.message).toContain('Projections consistent');
    expect(findings[0]!.message).toContain('0 task(s)');
  });

  it('detects missing task projections', () => {
    createTask(ctx, { title: 'No rebuild' });
    const findings = checkProjectionConsistency(ctx);
    const warns = findings.filter((f) => f.level === 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns.some((f) => f.message.includes('no projection'))).toBe(true);
  });

  it('reports ok when projections are consistent', () => {
    createTask(ctx, { title: 'Consistent' });
    createMeeting(ctx, { title: 'Consistent mtg' });
    registerAgent(ctx, { id: 'agent-diag', name: 'Diag', client: 'claude', roles: ['reviewer'], status: 'available' });
    rebuildAllProjections(ctx);

    const findings = checkProjectionConsistency(ctx);
    const ok = findings.filter((f) => f.level === 'ok');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok[0]?.message).toContain('consistent');
  });

  it('counts tombstones for deleted tasks', () => {
    const task = createTask(ctx, { title: 'Tombstone' });
    deleteTask(ctx, task.id);
    rebuildAllProjections(ctx);

    const findings = checkProjectionConsistency(ctx);
    expect(findings.some((f) => f.message.includes('Tombstones: 1'))).toBe(true);
  });

  it('reports corrupted projection as error (invalid JSON)', () => {
    const task = createTask(ctx, { title: 'Corrupt task' });
    rebuildAllProjections(ctx);

    // Corrupt the projection file
    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    writeFileSync(projPath, 'not valid json {{{', 'utf-8');

    const findings = checkProjectionConsistency(ctx);
    const errors = findings.filter((f) => f.level === 'error' && f.category === 'projections');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((f) => f.message.includes('corrupted'))).toBe(true);
  });

  it('reports corrupted projection as error (invalid schema)', () => {
    const task = createTask(ctx, { title: 'Bad schema task' });
    rebuildAllProjections(ctx);

    // Replace with valid JSON that fails schema (missing required _meta)
    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    writeFileSync(projPath, JSON.stringify({ id: task.id, type: 'wrong_type' }), 'utf-8');

    const findings = checkProjectionConsistency(ctx);
    const errors = findings.filter((f) => f.level === 'error' && f.category === 'projections');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((f) => f.message.includes('corrupted'))).toBe(true);
  });

  it('reports stale projection as warn (event seq > _meta.lastSequence)', () => {
    const task = createTask(ctx, { title: 'Stale task' });
    rebuildAllProjections(ctx);

    // Manually rewrite projection with lagging lastSequence
    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    const eventsPath = join(ctx.paths.eventsDir, 'events.jsonl');
    const eventsRaw = readFileSync(eventsPath, 'utf-8');
    const lines = eventsRaw.split('\n').filter((l: string) => l !== '');
    const maxSeq = Math.max(
      ...lines.map((l: string) => JSON.parse(l).sequence as number),
    );

    const projRaw = JSON.parse(readFileSync(projPath, 'utf-8')) as Record<string, unknown>;
    (projRaw._meta as Record<string, unknown>).lastSequence = maxSeq - 5;
    writeFileSync(projPath, JSON.stringify(projRaw), 'utf-8');

    const findings = checkProjectionConsistency(ctx);
    const warns = findings.filter((f) => f.level === 'warn' && f.category === 'projections');
    expect(warns.some((f) => f.message.includes('stale'))).toBe(true);
  });

  it('missing projection finding has resourceId, path, fixable, recommendation', () => {
    createTask(ctx, { title: 'Missing proj' });
    const findings = checkProjectionConsistency(ctx);
    const missing = findings.find((f) => f.message.includes('no projection'));
    expect(missing).toBeDefined();
    expect(missing!.resourceId).toBeDefined();
    expect(missing!.resourceId).toMatch(/^task_/);
    expect(missing!.path).toContain('projections');
    expect(missing!.path).toContain('.json');
    expect(missing!.fixable).toBe(true);
    expect(missing!.recommendation).toContain('mesa rebuild');
  });

  it('corrupted projection finding has resourceId, path, fixable, recommendation', () => {
    const task = createTask(ctx, { title: 'Corrupt extra' });
    rebuildAllProjections(ctx);
    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    writeFileSync(projPath, 'not valid json {{{', 'utf-8');

    const findings = checkProjectionConsistency(ctx);
    const corrupt = findings.find((f) => f.message.includes('corrupted'));
    expect(corrupt).toBeDefined();
    expect(corrupt!.resourceId).toBe(task.id);
    expect(corrupt!.path).toBe(projPath);
    expect(corrupt!.fixable).toBe(true);
    expect(corrupt!.recommendation).toContain('mesa rebuild');
  });

  it('stale projection finding has resourceId, path, fixable, recommendation', () => {
    const task = createTask(ctx, { title: 'Stale extra' });
    updateTaskStatus(ctx, task.id, 'in_progress'); // creates second event so maxSeq >= 1
    rebuildAllProjections(ctx);
    const projPath = join(ctx.paths.taskProjectionsDir, `${task.id}.json`);
    const projRaw = JSON.parse(readFileSync(projPath, 'utf-8')) as Record<string, unknown>;
    (projRaw._meta as Record<string, unknown>).lastSequence = 0; // set below maxSeq
    writeFileSync(projPath, JSON.stringify(projRaw), 'utf-8');

    const findings = checkProjectionConsistency(ctx);
    const stale = findings.find((f) => f.message.includes('stale'));
    expect(stale).toBeDefined();
    expect(stale!.resourceId).toBe(task.id);
    expect(stale!.path).toBe(projPath);
    expect(stale!.fixable).toBe(true);
    expect(stale!.recommendation).toContain('mesa rebuild');
  });

  it('detects missing meeting projection when only meeting events exist (no task events)', () => {
    createMeeting(ctx, { title: 'Meeting-only workspace' });
    const findings = checkProjectionConsistency(ctx);
    const meetingMissing = findings.filter((f) => f.message.includes('Meeting') && f.message.includes('no projection'));
    expect(meetingMissing.length).toBeGreaterThanOrEqual(1);
    const meetingIssue = findings.find((f) => f.message.includes('missing'));
    expect(meetingIssue).toBeDefined();
  });

  it('detects missing agent projection when only agent events exist (no task events)', () => {
    registerAgent(ctx, { id: 'agent-only', name: 'AgentOnly', client: 'claude', roles: ['builder'], status: 'available' });
    const findings = checkProjectionConsistency(ctx);
    const agentMissing = findings.filter((f) => f.message.includes('Agent') && f.message.includes('no projection'));
    expect(agentMissing.length).toBeGreaterThanOrEqual(1);
    const agentIssue = findings.find((f) => f.message.includes('missing'));
    expect(agentIssue).toBeDefined();
  });
});

describe('findOrphanedLocks', () => {
  it('returns ok when no locks exist', () => {
    const findings = findOrphanedLocks(ctx.paths);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('No lock files');
  });

  it('detects an orphaned lock (dead pid)', () => {
    // Write a fake lock file with a non-existent PID
    const lockPath = join(paths.locksDir, 'ffffffffffff.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({ resource: 'test_res', pid: 99999, token: 'abc', acquiredAt: new Date().toISOString() }),
      'utf-8',
    );
    const findings = findOrphanedLocks(ctx.paths);
    const warns = findings.filter((f) => f.level === 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0]?.message).toContain('Orphaned');
  });

  it('detects corrupt lock files', () => {
    const lockPath = join(paths.locksDir, 'corrupt.lock');
    writeFileSync(lockPath, 'not json', 'utf-8');
    const findings = findOrphanedLocks(ctx.paths);
    const warns = findings.filter((f) => f.level === 'warn');
    expect(warns.some((f) => f.message.includes('Corrupt'))).toBe(true);
  });

  it('orphaned lock finding has path, fixable, recommendation', () => {
    const lockPath = join(paths.locksDir, 'ffffffffffff.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({ resource: 'test_res', pid: 99999, token: 'abc', acquiredAt: new Date().toISOString() }),
      'utf-8',
    );
    const findings = findOrphanedLocks(ctx.paths);
    const orphaned = findings.find((f) => f.message.includes('Orphaned'));
    expect(orphaned).toBeDefined();
    expect(orphaned!.path).toBe(lockPath);
    expect(orphaned!.fixable).toBe(true);
    expect(orphaned!.recommendation).toContain('mesa doctor --fix');
  });
});

describe('checkAgentRunConsistency', () => {
  it('reports ok when runs are consistent', () => {
    createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    const findings = checkAgentRunConsistency(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe('ok');
    expect(findings[0]!.message).toContain('Agent runs consistent');
    expect(findings[0]!.message).toContain('1 run(s)');
  });

  it('reports ok with empty runs', () => {
    const findings = checkAgentRunConsistency(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe('ok');
  });

  it('detects an orphan run file (file but no event) as warn', () => {
    writeFileSync(join(ctx.paths.runsDir, 'run_orphan.json'), '{}', 'utf-8');
    const findings = checkAgentRunConsistency(ctx);
    const warns = findings.filter((f) => f.level === 'warn' && f.category === 'runs');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toContain('no agent_run_created event');
    expect(warns[0]!.resourceId).toBe('run_orphan');
  });

  it('detects a missing run file (event but no file) as error', () => {
    const run = createAgentRun(ctx, { agentId: 'a1', input: 'Test' });
    rmSync(join(ctx.paths.runsDir, `${run.id}.json`), { force: true });

    const findings = checkAgentRunConsistency(ctx);
    const errors = findings.filter((f) => f.level === 'error' && f.category === 'runs');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('no stored file');
    expect(errors[0]!.resourceId).toBe(run.id);
  });
});

describe('runAllDiagnostics', () => {
  it('returns findings from all categories', () => {
    const findings = runAllDiagnostics(ctx);
    // We expect at least events and locks findings for empty workspace
    const categories = new Set(findings.map((f) => f.category));
    expect(categories.has('events')).toBe(true);
    expect(categories.has('locks')).toBe(true);
  });

  it('returns projection findings when events exist', () => {
    createTask(ctx, { title: 'Diag task' });
    const findings = runAllDiagnostics(ctx);
    const categories = new Set(findings.map((f) => f.category));
    expect(categories.has('projections')).toBe(true);
  });
});
