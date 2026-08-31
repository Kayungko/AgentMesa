import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let testDir: string;
let claudeRoot: string;
let tempHome: string;
let server: DeskServer;
let prevClaudeRoot: string | undefined;
let prevHome: string | undefined;

/** Minimal but real Claude transcript: ai-title + user/assistant/tool turns. */
function writeClaudeFixture(): void {
  const projectDir = join(claudeRoot, 'E--FakeRepo');
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'ai-title', aiTitle: '修登录 bug' }),
    JSON.stringify({
      type: 'user',
      cwd: 'E:\\FakeRepo',
      timestamp: '2026-08-01T10:00:00.000Z',
      message: { content: '帮我修登录 bug' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T10:00:05.000Z',
      message: { content: [{ type: 'text', text: '我来看一下 auth 模块' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T10:00:06.000Z',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'auth.ts' } }] },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-08-01T10:00:07.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export function login() {}' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T10:00:08.000Z',
      message: { content: [{ type: 'thinking', thinking: '内部推理，不应导入' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T10:01:00.000Z',
      message: { content: [{ type: 'text', text: '修复完成' }] },
    }),
  ];
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), `${lines.join('\n')}\n`, 'utf-8');
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-imports-'));
  claudeRoot = mkdtempSync(join(tmpdir(), 'agentmesa-claude-root-'));
  initWorkspace(testDir);
  writeClaudeFixture();
  prevClaudeRoot = process.env.AGENTMESA_IMPORT_CLAUDE_ROOT;
  prevHome = process.env.AGENTMESA_HOME;
  process.env.AGENTMESA_IMPORT_CLAUDE_ROOT = claudeRoot;
  // Keep the global mesa home off the real user home for the duration.
  tempHome = mkdtempSync(join(tmpdir(), 'agentmesa-desk-home-'));
  process.env.AGENTMESA_HOME = tempHome;
});

afterEach(async () => {
  if (server) {
    await server.stop();
  }
  if (prevClaudeRoot === undefined) {
    delete process.env.AGENTMESA_IMPORT_CLAUDE_ROOT;
  } else {
    process.env.AGENTMESA_IMPORT_CLAUDE_ROOT = prevClaudeRoot;
  }
  if (prevHome === undefined) {
    delete process.env.AGENTMESA_HOME;
  } else {
    process.env.AGENTMESA_HOME = prevHome;
  }
  rmSync(testDir, { recursive: true, force: true });
  rmSync(claudeRoot, { recursive: true, force: true });
  rmSync(tempHome, { recursive: true, force: true });
});

function baseUrl(): string {
  return `http://localhost:${server.getPort()}`;
}

function authed(init?: RequestInit): RequestInit {
  return { ...init, headers: { ...(init?.headers ?? {}), Authorization: 'Bearer secret' } };
}

describe('DeskServer external-session imports', () => {
  it('GET /api/imports/external-sessions rejects a missing/invalid source', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();

    expect((await fetch(`${baseUrl()}/api/imports/external-sessions`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/imports/external-sessions?source=bogus`)).status).toBe(400);
  });

  it('GET /api/imports/external-sessions returns a sessions array (empty root tolerated)', async () => {
    // Point at an empty root: a machine with no ~/.claude/projects must get an
    // empty list, not an error.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'agentmesa-empty-root-'));
    process.env.AGENTMESA_IMPORT_CLAUDE_ROOT = emptyRoot;
    server = new DeskServer(testDir, 0);
    await server.start();

    const res = await fetch(`${baseUrl()}/api/imports/external-sessions?source=claude`);
    const body = (await res.json()) as { sessions: unknown[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(0);
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  it('GET /api/imports/external-sessions lists sessions from the injected scan root', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();

    const res = await fetch(`${baseUrl()}/api/imports/external-sessions?source=claude`);
    const body = (await res.json()) as { sessions: Array<{ sessionId: string; title: string }> };

    expect(res.status).toBe(200);
    const session = body.sessions.find((entry) => entry.sessionId === SESSION_ID);
    expect(session?.title).toBe('修登录 bug');
  });

  it('POST /api/meetings/import validates source and sessionId', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const badSource = await fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'bogus', sessionId: SESSION_ID }),
    }));
    expect(badSource.status).toBe(400);

    const badSession = await fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: '' }),
    }));
    expect(badSession.status).toBe(400);
  });

  it('POST /api/meetings/import returns 404 for an unknown session', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: 'no-such-session' }),
    }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toContain('EXTERNAL_SESSION_NOT_FOUND');
  });

  it('POST /api/meetings/import previewOnly returns up to 10 preview entries without importing', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: SESSION_ID, previewOnly: true }),
    }));
    const body = (await res.json()) as {
      meetingId: string | null;
      preview: Array<{ speaker: string; text: string; createdAt: string; kind: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.meetingId).toBeNull();
    expect(body.preview.length).toBeLessThanOrEqual(10);
    // Preview shows the raw parsed timeline (thinking included): 3 text,
    // 1 tool_use, 1 tool_result, 1 thinking = 6 entries.
    expect(body.preview).toHaveLength(6);
    expect(body.preview[0]).toMatchObject({
      speaker: 'user:imported-claude',
      text: '帮我修登录 bug',
      createdAt: '2026-08-01T10:00:00.000Z',
      kind: 'text',
    });

    // Preview must not have created a meeting.
    const meetings = await (await fetch(`${baseUrl()}/api/meetings`, authed())).json();
    expect(meetings).toHaveLength(0);
  });

  it('POST /api/meetings/import imports the session and the meeting timeline reads it back', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: SESSION_ID }),
    }));
    const body = (await res.json()) as { meetingId: string; messageCount: number };

    expect(res.status).toBe(201);
    expect(body.meetingId).toMatch(/^meeting_/);
    // 5 importable messages: thinking is skipped on import.
    expect(body.messageCount).toBe(5);

    // The timeline read path (GET /api/meetings/:id) must serve the imported
    // messages, with the historical timestamps preserved.
    const meetingRes = await fetch(`${baseUrl()}/api/meetings/${body.meetingId}`, authed());
    const meeting = (await meetingRes.json()) as {
      title: string;
      metadata: { source: string; externalSessionId: string };
      messages: Array<{ from: string; summary: string; createdAt: string }>;
    };

    expect(meetingRes.status).toBe(200);
    expect(meeting.title).toBe('修登录 bug');
    expect(meeting.metadata).toMatchObject({ source: 'claude', externalSessionId: SESSION_ID });
    expect(meeting.messages).toHaveLength(5);

    const sorted = [...meeting.messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(sorted[0]!.from).toBe('user:imported-claude');
    expect(sorted[0]!.createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(sorted.at(-1)!.createdAt).toBe('2026-08-01T10:01:00.000Z');
  });
});
