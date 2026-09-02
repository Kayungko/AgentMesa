import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { importExternalSession, listImportedExternalSessions, refreshImportedMeeting } from '../services/import-service.js';
import { getMeeting, createMeeting } from '../services/meeting-service.js';
import { listMessages, appendMessage } from '../services/message-service.js';
import { getAgent } from '../services/agent-registry.js';
import { parseClaudeSession } from '../external-sessions/claude-parser.js';
import type { ExternalMessage, ParsedExternalSession } from '../external-sessions/types.js';

let testDir: string;
let ctx: MesaRuntimeContext;

function countEventLines(): number {
  const file = join(testDir, '.agentmesa', 'events', 'events.jsonl');
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf-8').split('\n').filter((line) => line !== '').length;
}

function buildParsedSession(): ParsedExternalSession {
  const messages: ExternalMessage[] = [
    {
      kind: 'text',
      speaker: 'user:imported-claude',
      createdAt: '2026-08-01T10:00:00.000Z',
      summary: '帮我修一下登录 bug',
      body: '帮我修一下登录 bug',
    },
    {
      kind: 'thinking',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:02.000Z',
      summary: '先看 auth 模块…',
    },
    {
      kind: 'text',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:05.000Z',
      summary: '我来看一下 auth/login.ts',
      body: '我来看一下 auth/login.ts',
    },
    {
      kind: 'tool_use',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:06.000Z',
      summary: 'Read auth/login.ts',
      toolName: 'Read',
    },
    {
      kind: 'tool_result',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:07.000Z',
      summary: 'read auth/login.ts done',
      body: '1  export function login() {}',
      toolName: 'Read',
    },
    {
      kind: 'encrypted',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:08.000Z',
      summary: '<encrypted>',
    },
    {
      kind: 'turn_boundary',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:00:09.000Z',
      summary: 'task_started',
    },
    {
      kind: 'text',
      speaker: 'agent:claude-external',
      createdAt: '2026-08-01T10:01:00.000Z',
      summary: '修复完成',
      body: '修复完成',
    },
  ];
  return {
    summary: {
      source: 'claude',
      sessionId: 'session-abc-123',
      title: '修登录 bug',
      lastModified: '2026-08-01T10:01:00.000Z',
      sizeBytes: 1024,
      active: false,
    },
    filePath: 'C:/fake/.claude/projects/p/session-abc-123.jsonl',
    startedAt: '2026-08-01T10:00:00.000Z',
    messages,
  };
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-import-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('importExternalSession', () => {
  it('creates a meeting and writes the visible messages', () => {
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });

    expect(result.meetingId).toMatch(/^meeting_/);
    expect(result.messageCount).toBe(5);

    const meeting = getMeeting(ctx, result.meetingId);
    expect(meeting.title).toBe('修登录 bug');

    // The timeline read path (GET /api/meetings/:id → listMessages filtered by
    // meetingId) must see exactly the 5 importable messages — thinking /
    // encrypted / turn_boundary are skipped.
    const meetingMessages = listMessages(ctx)
      .filter((m) => m.meetingId === result.meetingId)
      // listMessages returns files in directory order; the timeline orders by
      // createdAt (client-side), so assert on the sorted view.
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(meetingMessages).toHaveLength(5);
    expect(meetingMessages.map((m) => m.summary)).toEqual([
      '帮我修一下登录 bug',
      '我来看一下 auth/login.ts',
      'Read auth/login.ts',
      'read auth/login.ts done',
      '修复完成',
    ]);
  });

  it('appends exactly one meeting_imported event regardless of message count', () => {
    const before = countEventLines();

    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });

    const after = countEventLines();
    const events = ctx.eventStore.list();

    // 5 visible messages must NOT produce 5 message_sent events: the whole
    // import costs exactly 3 events — agent_registered (first import),
    // meeting_created, and one meeting_imported.
    expect(after - before).toBe(3);
    expect(events.map((event) => event.type)).toEqual([
      'agent_registered',
      'meeting_created',
      'meeting_imported',
    ]);
    const imported = ctx.eventStore.list({ type: 'meeting_imported' });
    expect(imported).toHaveLength(1);
    expect(imported[0]!.data).toMatchObject({
      meetingId: result.meetingId,
      source: 'claude',
      externalSessionId: 'session-abc-123',
      messageCount: 5,
    });
    expect(ctx.eventStore.list({ type: 'message_sent' })).toHaveLength(0);
  });

  it('preserves historical createdAt on the imported message files', () => {
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });

    const messages = listMessages(ctx).filter((m) => m.meetingId === result.meetingId);
    const sorted = [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(sorted[0]!.createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(sorted[0]!.from).toBe('user:imported-claude');
    expect(sorted.at(-1)!.createdAt).toBe('2026-08-01T10:01:00.000Z');
    // Import provenance rides on every message.
    expect(sorted[0]!.metadata).toMatchObject({
      source: 'claude',
      externalSessionId: 'session-abc-123',
    });
  });

  it('stamps the meeting with import metadata', () => {
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });

    const meeting = getMeeting(ctx, result.meetingId);
    expect(meeting.metadata).toMatchObject({
      source: 'claude',
      externalSessionId: 'session-abc-123',
    });
    expect(typeof meeting.metadata?.importedAt).toBe('string');
  });

  it('registers the external agent identity exactly once', () => {
    importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });

    const agent = getAgent(ctx, 'agent:claude-external');
    expect(agent.name).toBe('Claude（外部导入）');
    expect(agent.client).toBe('claude-code');

    // Second import of another session with the same speaker: no duplicate
    // agent_registered event.
    const before = countEventLines();
    const second = buildParsedSession();
    second.summary.sessionId = 'session-def-456';
    importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-def-456',
      parsed: second,
    });

    expect(countEventLines() - before).toBe(2); // meeting_created + meeting_imported only
    expect(ctx.eventStore.list({ type: 'agent_registered' })).toHaveLength(1);
  });

  it('falls back to a generated title when the summary title is empty', () => {
    const parsed = buildParsedSession();
    parsed.summary.title = '';
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed,
    });

    expect(result.meetingId).toMatch(/^meeting_/);
    expect(getMeeting(ctx, result.meetingId).title).toBe('外部会话导入 session-abc-123');
  });

  it('records refresh anchors (sourceFilePath/LastModified/SizeBytes) and per-message externalLineId', () => {
    const parsed = buildParsedSession();
    parsed.messages[0]!.externalLineId = 'line-uuid-1';
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed,
    });

    const meeting = getMeeting(ctx, result.meetingId);
    expect(meeting.metadata).toMatchObject({
      source: 'claude',
      externalSessionId: 'session-abc-123',
      sourceFilePath: 'C:/fake/.claude/projects/p/session-abc-123.jsonl',
      sourceLastModified: '2026-08-01T10:01:00.000Z',
      sourceSizeBytes: 1024,
    });

    const first = listMessages(ctx)
      .filter((m) => m.meetingId === result.meetingId)
      .find((m) => m.summary === '帮我修一下登录 bug');
    expect(first?.metadata).toMatchObject({ externalLineId: 'line-uuid-1' });
  });

  it('stamps a groupName into metadata and the title prefix', () => {
    const result = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
      groupName: '总控接管',
    });

    const meeting = getMeeting(ctx, result.meetingId);
    expect(meeting.title).toBe('[总控接管] 修登录 bug');
    expect(meeting.metadata?.groupName).toBe('总控接管');

    // Messages carry the group too (same provenance block).
    const message = listMessages(ctx).find((m) => m.meetingId === result.meetingId);
    expect(message?.metadata).toMatchObject({ groupName: '总控接管' });
  });
});

describe('refreshImportedMeeting', () => {
  /** Real Claude transcript fixture the refresh path can re-parse. */
  function seedTranscript(sourceDir: string): string {
    const filePath = join(sourceDir, 'session-refresh-1.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({ type: 'user', uuid: 'u-1', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'first turn' } }),
        JSON.stringify({ type: 'assistant', uuid: 'a-1', timestamp: '2026-08-01T10:00:01.000Z', message: { content: [{ type: 'text', text: 'first answer' }] } }),
        '',
      ].join('\n'),
      'utf-8',
    );
    return filePath;
  }

  it('re-imports the source, replaces the snapshot and preserves user-authored messages', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'agentmesa-refresh-src-'));
    try {
      const filePath = seedTranscript(sourceDir);
      const parsed = parseClaudeSession(filePath);
      const { meetingId } = importExternalSession(ctx, {
        source: 'claude',
        sessionId: 'session-refresh-1',
        parsed,
      });

      // A user message authored in the meeting AFTER the import.
      appendMessage(ctx, {
        meetingId,
        type: 'general',
        summary: '用户会后追问',
        body: '用户会后追问',
      });

      // The external conversation continues.
      writeFileSync(
        filePath,
        [
          ...readFileSync(filePath, 'utf-8').split('\n').filter((line) => line !== ''),
          JSON.stringify({ type: 'user', uuid: 'u-2', timestamp: '2026-08-01T11:00:00.000Z', message: { content: 'second turn' } }),
          JSON.stringify({ type: 'assistant', uuid: 'a-2', timestamp: '2026-08-01T11:00:01.000Z', message: { content: [{ type: 'text', text: 'second answer' }] } }),
          '',
        ].join('\n'),
        'utf-8',
      );
      utimesSync(filePath, new Date(), new Date(Date.now() + 60_000));

      const refreshed = refreshImportedMeeting(ctx, meetingId);
      expect(refreshed.meetingId).toBe(meetingId);
      expect(refreshed.messageCount).toBe(4);

      const messages = listMessages(ctx).filter((m) => m.meetingId === meetingId);
      // Snapshot replaced: 4 imported + 1 user-authored = 5 (no stale copies).
      expect(messages).toHaveLength(5);
      expect(messages.some((m) => m.summary === 'second answer')).toBe(true);
      expect(messages.filter((m) => m.summary === 'first answer')).toHaveLength(1);
      expect(messages.some((m) => m.summary === '用户会后追问')).toBe(true);

      // Meeting anchors moved to the new source state.
      const meeting = getMeeting(ctx, meetingId);
      expect(meeting.metadata?.sourceLastModified).not.toBe(parsed.summary.lastModified);
      expect(meeting.metadata?.refreshedAt).toBeTruthy();

      // One more meeting_imported event (refresh reuses the event type).
      const importedEvents = ctx.eventStore.list({ type: 'meeting_imported' });
      expect(importedEvents).toHaveLength(2);
      expect(importedEvents[1]!.data).toMatchObject({ meetingId, messageCount: 4, refreshed: true });
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects a meeting without import provenance', () => {
    const meeting = createMeeting(ctx, { title: '普通会议' });
    expect(() => refreshImportedMeeting(ctx, meeting.id)).toThrow(/no refreshable import provenance/);
  });

  it('rejects an unknown meeting id', () => {
    expect(() => refreshImportedMeeting(ctx, 'meeting_missing')).toThrow(/not found/);
  });

  // --- P1 incremental refresh ---

  /** Import from a seeded transcript and return (meetingId, filePath). */
  function importFromSeed(): { meetingId: string; filePath: string } {
    const sourceDir = mkdtempSync(join(tmpdir(), 'agentmesa-incr-src-'));
    const filePath = seedTranscript(sourceDir);
    const parsed = parseClaudeSession(filePath);
    const { meetingId } = importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-refresh-1',
      parsed,
    });
    return { meetingId, filePath };
  }

  function appendLines(filePath: string, lines: Array<Record<string, unknown>>): void {
    writeFileSync(
      filePath,
      [
        ...readFileSync(filePath, 'utf-8').split('\n').filter((line) => line !== ''),
        ...lines.map((line) => JSON.stringify(line)),
        '',
      ].join('\n'),
      'utf-8',
    );
    utimesSync(filePath, new Date(), new Date(Date.now() + 60_000));
  }

  function snapshotIds(meetingId: string): string[] {
    return listMessages(ctx)
      .filter((m) => m.meetingId === meetingId)
      .map((m) => m.id)
      .sort();
  }

  it('appends incrementally: existing message ids stay stable, new lines get new files', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      const before = snapshotIds(meetingId);

      appendLines(filePath, [
        { type: 'user', uuid: 'u-3', timestamp: '2026-08-01T12:00:00.000Z', message: { content: 'third turn' } },
        { type: 'assistant', uuid: 'a-3', timestamp: '2026-08-01T12:00:01.000Z', message: { content: [{ type: 'text', text: 'third answer' }] } },
      ]);

      const result = refreshImportedMeeting(ctx, meetingId);
      expect(result.mode).toBe('incremental');
      expect(result.appendedCount).toBe(2);
      expect(result.removedCount).toBe(0);
      expect(result.messageCount).toBe(4);

      const after = snapshotIds(meetingId);
      expect(after).toHaveLength(before.length + 2);
      // Id stability is THE point of P1: every pre-existing id survives.
      for (const id of before) {
        expect(after).toContain(id);
      }
      expect(listMessages(ctx).some((m) => m.meetingId === meetingId && m.summary === 'third answer')).toBe(true);

      // Exactly one new meeting_imported event carrying the diff counts.
      const events = ctx.eventStore.list({ type: 'meeting_imported' });
      expect(events).toHaveLength(2);
      expect(events[1]!.data).toMatchObject({
        meetingId,
        refreshed: true,
        mode: 'incremental',
        appendedCount: 2,
        removedCount: 0,
      });
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('zero-diff refresh: no new event, anchors still move', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      const first = refreshImportedMeeting(ctx, meetingId);
      expect(first.appendedCount).toBe(0);
      expect(first.removedCount).toBe(0);

      const eventsAfterFirst = ctx.eventStore.list({ type: 'meeting_imported' });
      const idsAfterFirst = snapshotIds(meetingId);

      const second = refreshImportedMeeting(ctx, meetingId);
      expect(second.appendedCount).toBe(0);
      expect(second.removedCount).toBe(0);

      // No event for a no-op refresh — SSE clients must not reload.
      expect(ctx.eventStore.list({ type: 'meeting_imported' })).toHaveLength(eventsAfterFirst.length);
      expect(snapshotIds(meetingId)).toEqual(idsAfterFirst);

      const meeting = getMeeting(ctx, meetingId);
      expect(meeting.metadata?.refreshedAt).toBeTruthy();
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('removes messages whose line anchor vanished from the source (compaction)', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      const before = snapshotIds(meetingId);

      // Rewrite the source WITHOUT the second line (a-1 vanishes).
      writeFileSync(
        filePath,
        [
          JSON.stringify({ type: 'user', uuid: 'u-1', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'first turn' } }),
          '',
        ].join('\n'),
        'utf-8',
      );
      utimesSync(filePath, new Date(), new Date(Date.now() + 60_000));

      const result = refreshImportedMeeting(ctx, meetingId);
      expect(result.mode).toBe('incremental');
      expect(result.removedCount).toBe(1);
      expect(result.appendedCount).toBe(0);
      expect(result.messageCount).toBe(1);

      const after = snapshotIds(meetingId);
      expect(after).toHaveLength(before.length - 1);
      expect(listMessages(ctx).some((m) => m.meetingId === meetingId && m.summary === 'first answer')).toBe(false);
      expect(listMessages(ctx).some((m) => m.meetingId === meetingId && m.summary === 'first turn')).toBe(true);
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('handles a mixed append+remove refresh', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      writeFileSync(
        filePath,
        [
          JSON.stringify({ type: 'user', uuid: 'u-1', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'first turn' } }),
          JSON.stringify({ type: 'user', uuid: 'u-9', timestamp: '2026-08-01T13:00:00.000Z', message: { content: 'new turn' } }),
          JSON.stringify({ type: 'assistant', uuid: 'a-9', timestamp: '2026-08-01T13:00:01.000Z', message: { content: [{ type: 'text', text: 'new answer' }] } }),
          '',
        ].join('\n'),
        'utf-8',
      );
      utimesSync(filePath, new Date(), new Date(Date.now() + 60_000));

      const result = refreshImportedMeeting(ctx, meetingId);
      expect(result.appendedCount).toBe(2);
      expect(result.removedCount).toBe(1);
      expect(result.messageCount).toBe(3);
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('degrades to replace when the snapshot holds messages without a line anchor', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      // Corrupt one snapshot message: strip its externalLineId (simulates a
      // pre-anchor import from an older version).
      const messages = listMessages(ctx).filter((m) => m.meetingId === meetingId);
      const victim = messages[0]!;
      const victimFile = join(ctx.paths.messagesDir, `${victim.id}.json`);
      const raw = JSON.parse(readFileSync(victimFile, 'utf-8')) as { metadata: Record<string, unknown> };
      delete raw.metadata.externalLineId;
      writeFileSync(victimFile, JSON.stringify(raw, null, 2), 'utf-8');

      // A user message authored after the import must survive the degraded replace.
      appendMessage(ctx, { meetingId, type: 'general', summary: '用户会后追问', body: '用户会后追问' });

      const before = snapshotIds(meetingId);
      const result = refreshImportedMeeting(ctx, meetingId);
      expect(result.mode).toBe('replace');
      expect(result.degradedToReplace).toBe(true);

      const after = snapshotIds(meetingId);
      // Snapshot ids regenerated; the user-authored message preserved.
      expect(after).toHaveLength(3);
      expect(listMessages(ctx).some((m) => m.meetingId === meetingId && m.summary === '用户会后追问')).toBe(true);
      expect(before.length).toBeGreaterThan(0);
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('explicit replace mode regenerates ids like P0', () => {
    const { meetingId, filePath } = importFromSeed();
    try {
      const before = snapshotIds(meetingId);
      const result = refreshImportedMeeting(ctx, meetingId, { mode: 'replace' });
      expect(result.mode).toBe('replace');
      expect(result.degradedToReplace).toBeUndefined();
      expect(result.messageCount).toBe(2);
      expect(result.appendedCount).toBe(2);

      const after = snapshotIds(meetingId);
      expect(after).toHaveLength(before.length);
      // Full rewrite: ids do not overlap with the previous set.
      for (const id of after) {
        expect(before).not.toContain(id);
      }

      const events = ctx.eventStore.list({ type: 'meeting_imported' });
      expect(events[1]!.data).toMatchObject({ refreshed: true, mode: 'replace', appendedCount: 2, removedCount: 2 });
    } finally {
      rmSync(dirname(filePath), { recursive: true, force: true });
    }
  });

  it('treats duplicate externalLineIds as a multiset (occurrence pairing)', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'agentmesa-multi-src-'));
    try {
      // Two lines share the uuid 'dup-1' — each yields one message.
      const filePath = join(sourceDir, 'session-multi.jsonl');
      writeFileSync(
        filePath,
        [
          JSON.stringify({ type: 'user', uuid: 'dup-1', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'dup first' } }),
          JSON.stringify({ type: 'user', uuid: 'dup-1', timestamp: '2026-08-01T10:00:01.000Z', message: { content: 'dup second' } }),
          '',
        ].join('\n'),
        'utf-8',
      );
      const parsed = parseClaudeSession(filePath);
      const { meetingId } = importExternalSession(ctx, { source: 'claude', sessionId: 'session-multi', parsed });
      expect(snapshotIds(meetingId)).toHaveLength(2);

      // Append a THIRD line with the same uuid → exactly one new message.
      appendLines(filePath, [
        { type: 'user', uuid: 'dup-1', timestamp: '2026-08-01T10:00:02.000Z', message: { content: 'dup third' } },
      ]);
      const grown = refreshImportedMeeting(ctx, meetingId);
      expect(grown.appendedCount).toBe(1);
      expect(grown.removedCount).toBe(0);
      expect(grown.messageCount).toBe(3);

      // Drop back to two lines → exactly one removed, the other survivor stays.
      writeFileSync(
        filePath,
        [
          JSON.stringify({ type: 'user', uuid: 'dup-1', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'dup first' } }),
          JSON.stringify({ type: 'user', uuid: 'dup-1', timestamp: '2026-08-01T10:00:01.000Z', message: { content: 'dup second' } }),
          '',
        ].join('\n'),
        'utf-8',
      );
      utimesSync(filePath, new Date(), new Date(Date.now() + 60_000));
      const shrunk = refreshImportedMeeting(ctx, meetingId);
      expect(shrunk.appendedCount).toBe(0);
      expect(shrunk.removedCount).toBe(1);
      expect(shrunk.messageCount).toBe(2);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});

describe('listImportedExternalSessions', () => {
  it('indexes imported meetings by source + external session id', () => {
    importExternalSession(ctx, {
      source: 'claude',
      sessionId: 'session-abc-123',
      parsed: buildParsedSession(),
    });
    createMeeting(ctx, { title: '普通会议' });

    const imported = listImportedExternalSessions(ctx);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      source: 'claude',
      externalSessionId: 'session-abc-123',
      sourceLastModified: '2026-08-01T10:01:00.000Z',
      sourceSizeBytes: 1024,
    });
    expect(imported[0]!.meetingId).toMatch(/^meeting_/);
  });
});
