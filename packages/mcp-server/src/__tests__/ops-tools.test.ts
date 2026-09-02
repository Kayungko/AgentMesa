import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaTask } from '@agentmesa/protocol';
import { handleCreateTask, handleDoctor, handleGetEvents } from '../tools.js';
import { ToolError } from '../tool-errors.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-mcp-ops-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function parse<T>(result: string): T {
  return JSON.parse(result) as T;
}

interface DoctorFinding {
  level: 'ok' | 'warn' | 'error';
  category: string;
  message: string;
  path?: string;
  resourceId?: string;
  fixable?: boolean;
  recommendation?: string;
}

interface DoctorResult {
  summary: { total: number; ok: number; warn: number; error: number };
  findings: { error: DoctorFinding[]; warn: DoctorFinding[]; ok: DoctorFinding[] };
}

interface EventSummary {
  id: string;
  type: string;
  actor: string;
  timestamp: string;
  streamId: string;
  streamType: string;
  sequence: number;
  dataSummary: string;
}

interface GetEventsResult {
  total: number;
  returned: number;
  limit: number;
  truncated: boolean;
  events: EventSummary[];
}

describe('handleDoctor', () => {
  it('reports an empty workspace with only ok findings', () => {
    const result = parse<DoctorResult>(handleDoctor(ctx));

    expect(result.summary.warn).toBe(0);
    expect(result.summary.error).toBe(0);
    expect(result.summary.total).toBe(result.summary.ok);
    expect(result.findings.error).toEqual([]);
    expect(result.findings.warn).toEqual([]);
    expect(result.findings.ok.length).toBeGreaterThan(0);

    const categories = new Set(result.findings.ok.map((f) => f.category));
    expect(categories.has('events')).toBe(true);
    expect(categories.has('projections')).toBe(true);
  });

  it('flags a missing task projection as a warn finding without modifying state', () => {
    // Each created task appends events but no projection file until `mesa
    // rebuild` runs — the canonical warn case for the doctor.
    handleCreateTask(ctx, { title: 'No rebuild', createdBy: 'user' });
    const eventsPath = join(ctx.paths.eventsDir, 'events.jsonl');
    const before = readFileSync(eventsPath, 'utf-8');

    const result = parse<DoctorResult>(handleDoctor(ctx));

    expect(result.summary.warn).toBeGreaterThanOrEqual(1);
    const missing = result.findings.warn.find((f) => f.message.includes('no projection'));
    expect(missing).toBeDefined();
    expect(missing!.category).toBe('projections');
    expect(missing!.resourceId).toMatch(/^task_/);
    expect(missing!.fixable).toBe(true);
    expect(missing!.recommendation).toContain('mesa rebuild');

    // Read-only contract: the diagnostics suite must not touch the log.
    expect(readFileSync(eventsPath, 'utf-8')).toBe(before);
  });
});

describe('handleGetEvents', () => {
  it('returns compact summaries of the most recent events', () => {
    const task = parse<MesaTask>(
      handleCreateTask(ctx, { title: 'Ops query', createdBy: 'user' })
    );
    const result = parse<GetEventsResult>(handleGetEvents(ctx, {}));

    // One message_sent + one task_created event per task.
    expect(result.total).toBe(2);
    expect(result.returned).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.truncated).toBe(false);

    const created = result.events.find((e) => e.type === 'task_created');
    expect(created).toBeDefined();
    expect(created!.streamId).toBe(task.id);
    expect(created!.actor).toBe('user');
    expect(created!.timestamp).toMatch(/^\d{4}-/);
    expect(created!.dataSummary).toContain('Ops query');
  });

  it('filters by streamId and returns an empty list for an unknown stream', () => {
    const task = parse<MesaTask>(
      handleCreateTask(ctx, { title: 'Filtered', createdBy: 'user' })
    );

    const byStream = parse<GetEventsResult>(handleGetEvents(ctx, { streamId: task.id }));
    expect(byStream.total).toBe(1);
    expect(byStream.events).toHaveLength(1);
    expect(byStream.events[0]!.type).toBe('task_created');
    expect(byStream.events[0]!.streamId).toBe(task.id);

    const empty = parse<GetEventsResult>(
      handleGetEvents(ctx, { streamId: 'task_does_not_exist' })
    );
    expect(empty.total).toBe(0);
    expect(empty.events).toEqual([]);
    expect(empty.truncated).toBe(false);
  });

  it('clamps limit to the maximum and returns the most recent tail window', () => {
    // 3 tasks → 6 events; ask for a window of 2.
    const tasks = [1, 2, 3].map((n) =>
      parse<MesaTask>(handleCreateTask(ctx, { title: `Task ${n}`, createdBy: 'user' }))
    );

    const clamped = parse<GetEventsResult>(handleGetEvents(ctx, { limit: 9999 }));
    expect(clamped.limit).toBe(500);
    expect(clamped.returned).toBe(6);

    const window = parse<GetEventsResult>(handleGetEvents(ctx, { limit: 2 }));
    expect(window.total).toBe(6);
    expect(window.returned).toBe(2);
    expect(window.truncated).toBe(true);
    // Tail window: the newest event is the last task's task_created event.
    expect(window.events.at(-1)!.type).toBe('task_created');
    expect(window.events.at(-1)!.streamId).toBe(tasks.at(-1)!.id);
  });

  it('rejects an unknown event type instead of filtering to an empty list', () => {
    expect(() => handleGetEvents(ctx, { type: 'bogus_event' })).toThrow(ToolError);
  });
});
