import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MesaEvent } from '@agentmesa/protocol';
import { currentProtocolVersion } from '@agentmesa/protocol';
import { FileEventStore } from '../runtime/file-event-store.js';
import { MesaError } from '../errors.js';

let testDir: string;
let store: FileEventStore;

function makeEvent(overrides: Partial<MesaEvent> = {}): MesaEvent {
  return {
    protocolVersion: currentProtocolVersion,
    id: 'event_00000001',
    meetingId: 'meeting_test',
    type: 'task_created',
    streamId: 'task_test',
    streamType: 'task',
    data: {},
    actor: 'user:test',
    sequence: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-fe-'));
  store = new FileEventStore(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('FileEventStore.append + list', () => {
  it('appends and lists a single event', () => {
    const event = makeEvent();
    store.append(event);
    expect(store.list()).toEqual([event]);
  });

  it('appends multiple events in insertion order', () => {
    const a = makeEvent({ id: 'event_a', sequence: 0 });
    const b = makeEvent({ id: 'event_b', sequence: 1 });
    store.append(a);
    store.append(b);
    expect(store.list()).toEqual([a, b]);
  });

  it('writes events.jsonl to the given directory', () => {
    store.append(makeEvent());
    const raw = readFileSync(join(testDir, 'events.jsonl'), 'utf-8');
    expect(raw).toContain('"type":"task_created"');
    expect(raw).not.toContain('\n\n'); // no blank lines
  });
});

describe('FileEventStore.list filter', () => {
  it('filters by type', () => {
    store.append(makeEvent({ id: 'e1', type: 'task_created' }));
    store.append(makeEvent({ id: 'e2', type: 'task_assigned' }));
    expect(store.list({ type: 'task_created' }).map((e) => e.id)).toEqual(['e1']);
  });

  it('filters by streamId', () => {
    store.append(makeEvent({ id: 'e1', streamId: 'task_abc' }));
    store.append(makeEvent({ id: 'e2', streamId: 'task_xyz' }));
    expect(store.list({ streamId: 'task_abc' }).map((e) => e.id)).toEqual(['e1']);
  });

  it('filters by actor', () => {
    store.append(makeEvent({ id: 'e1', actor: 'user:alice' }));
    store.append(makeEvent({ id: 'e2', actor: 'agent:bob' }));
    expect(store.list({ actor: 'user:alice' }).map((e) => e.id)).toEqual(['e1']);
    expect(store.list({ actor: 'agent:nobody' })).toEqual([]);
  });

  it('filters by meetingId', () => {
    store.append(makeEvent({ id: 'e1', meetingId: 'meeting_a' }));
    store.append(makeEvent({ id: 'e2', meetingId: 'meeting_b' }));
    expect(store.list({ meetingId: 'meeting_a' }).map((e) => e.id)).toEqual(['e1']);
  });

  it('combines multiple filters', () => {
    store.append(makeEvent({ id: 'e1', streamId: 'task_abc', type: 'task_created', meetingId: 'meeting_a' }));
    store.append(makeEvent({ id: 'e2', streamId: 'task_abc', type: 'task_assigned', meetingId: 'meeting_a' }));
    store.append(makeEvent({ id: 'e3', streamId: 'task_xyz', type: 'task_created', meetingId: 'meeting_b' }));
    expect(store.list({ streamId: 'task_abc', type: 'task_created' }).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('FileEventStore.list edge cases', () => {
  it('returns empty array when events file does not exist', () => {
    expect(store.list()).toEqual([]);
    expect(store.list({ streamId: 'anything' })).toEqual([]);
  });

  it('ignores empty lines (e.g. trailing newline)', () => {
    appendFileSync(join(testDir, 'events.jsonl'), `${JSON.stringify(makeEvent({ id: 'e1' }))}\n\n`, 'utf-8');
    const results = store.list();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('e1');
  });

  it('throws MesaError on a corrupted line', () => {
    appendFileSync(join(testDir, 'events.jsonl'), `${JSON.stringify(makeEvent({ id: 'ok' }))}\nnot-json\n`, 'utf-8');
    expect(() => store.list()).toThrow(MesaError);
    expect(() => store.list()).toThrow('Corrupted event line');
  });

  it('throws MesaError on valid JSON that fails MesaEventSchema', () => {
    appendFileSync(
      join(testDir, 'events.jsonl'),
      `${JSON.stringify(makeEvent({ id: 'ok' }))}\n${JSON.stringify({ type: 'nope', extra: true })}\n`,
      'utf-8',
    );
    expect(() => store.list()).toThrow(MesaError);
    expect(() => store.list()).toThrow('Invalid event');
  });

  it('rejects an event missing required fields', () => {
    appendFileSync(
      join(testDir, 'events.jsonl'),
      JSON.stringify({ id: 'event_x', type: 'task_created' }) + '\n',
      'utf-8',
    );
    expect(() => store.list()).toThrow(MesaError);
    expect(() => store.list()).toThrow('Invalid event');
  });

  it('survives a fresh store instance (durability)', () => {
    store.append(makeEvent({ id: 'e_persist', type: 'task_created', streamId: 's1' }));
    expect(store.list()).toHaveLength(1);

    // Create a fresh store pointing at the same file
    const store2 = new FileEventStore(testDir);
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0]?.id).toBe('e_persist');
  });

  it('appends are immediately visible to the same store instance', () => {
    store.append(makeEvent({ id: 'e_a', type: 'task_created', streamId: 'sa' }));
    store.append(makeEvent({ id: 'e_b', type: 'task_status_changed', streamId: 'sa' }));
    expect(store.list()).toHaveLength(2);
    expect(store.list({ streamId: 'sa' })).toHaveLength(2);
  });
});
