import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { importExternalSession } from '../services/import-service.js';
import { getMeeting } from '../services/meeting-service.js';
import { listMessages } from '../services/message-service.js';
import { getAgent } from '../services/agent-registry.js';
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
});
