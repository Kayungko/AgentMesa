import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NESTED_SESSION_ID = '11111111-2222-3333-4444-555555555555';

let testDir: string;
let claudeRoot: string;
let tempHome: string;
let server: DeskServer;
let prevClaudeRoot: string | undefined;
let prevHome: string | undefined;
let prevSessionDriver: string | undefined;

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
  // Precheck-miss fixture: the import scanner (core) walks recursively so a
  // transcript nested one level deeper still imports, while the adopt
  // precheck (runner, bounded one-level scan of project dirs) misses it.
  const nestedDir = join(projectDir, 'subagents');
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(
    join(nestedDir, `${NESTED_SESSION_ID}.jsonl`),
    `${[
      JSON.stringify({ type: 'ai-title', aiTitle: '嵌套会话' }),
      JSON.stringify({
        type: 'user',
        cwd: 'E:\\FakeRepo',
        timestamp: '2026-08-01T11:00:00.000Z',
        message: { content: '嵌套 fixture 消息' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-01T11:00:05.000Z',
        message: { content: [{ type: 'text', text: '嵌套回复' }] },
      }),
    ].join('\n')}\n`,
    'utf-8',
  );
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-imports-'));
  claudeRoot = mkdtempSync(join(tmpdir(), 'agentmesa-claude-root-'));
  initWorkspace(testDir);
  writeClaudeFixture();
  prevClaudeRoot = process.env.AGENTMESA_IMPORT_CLAUDE_ROOT;
  prevHome = process.env.AGENTMESA_HOME;
  prevSessionDriver = process.env.AGENTMESA_SESSION_DRIVER;
  process.env.AGENTMESA_IMPORT_CLAUDE_ROOT = claudeRoot;
  // Deterministic driver mode: unset → resolveSessionDriverPreference() === 'cli'.
  delete process.env.AGENTMESA_SESSION_DRIVER;
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
  if (prevSessionDriver === undefined) {
    delete process.env.AGENTMESA_SESSION_DRIVER;
  } else {
    process.env.AGENTMESA_SESSION_DRIVER = prevSessionDriver;
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

  // --- Phase 2 adopt: seeding the driver-handle sidecar on import ---

  interface ImportResponseBody {
    meetingId: string;
    messageCount: number;
    adopted: boolean;
    adoptError?: string;
    driverMode?: string;
    adoptWarning?: string;
  }

  function sidecarPath(): string {
    return join(testDir, '.agentmesa', 'driver-sessions', 'agent_claude-external.json');
  }

  function postImport(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl()}/api/meetings/import`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }

  it('POST /api/meetings/import adopt=true seeds the driver handle sidecar for the external agent', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await postImport({ source: 'claude', sessionId: SESSION_ID, adopt: true });
    const body = (await res.json()) as ImportResponseBody;

    expect(res.status).toBe(201);
    expect(body.adopted).toBe(true);
    expect(body.adoptError).toBeUndefined();
    // Test env has no AGENTMESA_SESSION_DRIVER → resolved preference is 'cli',
    // and a seeded-but-inactive handle must carry the cli-mode warning.
    expect(body.driverMode).toBe('cli');
    expect(body.adoptWarning).toContain('AGENTMESA_SESSION_DRIVER');

    // Sidecar written under the workspace's .agentmesa/driver-sessions/ with
    // the sanitized agent id as the file name.
    expect(existsSync(sidecarPath())).toBe(true);
    const record = JSON.parse(readFileSync(sidecarPath(), 'utf-8')) as {
      agentId: string;
      sessions: Record<string, { handle: { kind: string; backendSessionId: string } }>;
    };
    expect(record.agentId).toBe('agent:claude-external');
    const entry = record.sessions[body.meetingId];
    expect(entry).toBeDefined();
    expect(entry!.handle.kind).toBe('claude-agent-sdk');
    expect(entry!.handle.backendSessionId).toBe(SESSION_ID);
  });

  it('POST /api/meetings/import omits adoptWarning when the session driver is not cli', async () => {
    process.env.AGENTMESA_SESSION_DRIVER = 'auto';
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await postImport({ source: 'claude', sessionId: SESSION_ID, adopt: true });
    const body = (await res.json()) as ImportResponseBody;

    expect(res.status).toBe(201);
    expect(body.adopted).toBe(true);
    expect(body.driverMode).toBe('auto');
    expect(body.adoptWarning).toBeUndefined();
    expect(existsSync(sidecarPath())).toBe(true);
  });

  it('POST /api/meetings/import adopt=true degrades to adopted:false when the Claude precheck misses', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    // NESTED_SESSION_ID imports (core's scanner walks recursively) but the
    // adopt precheck only looks at direct children of project dirs → miss.
    const res = await postImport({ source: 'claude', sessionId: NESTED_SESSION_ID, adopt: true });
    const body = (await res.json()) as ImportResponseBody;

    expect(res.status).toBe(201);
    // The snapshot import still succeeded — only adoption failed.
    expect(body.meetingId).toMatch(/^meeting_/);
    expect(body.messageCount).toBeGreaterThan(0);
    expect(body.adopted).toBe(false);
    expect(body.adoptError).toBeTruthy();
    expect(body.adoptError).toContain(NESTED_SESSION_ID);
    // Failed adoption must not leave a sidecar behind.
    expect(existsSync(sidecarPath())).toBe(false);
  });

  it('POST /api/meetings/import without adopt (or adopt:false) writes no sidecar', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const noFlag = await postImport({ source: 'claude', sessionId: SESSION_ID });
    const noFlagBody = (await noFlag.json()) as ImportResponseBody;
    expect(noFlag.status).toBe(201);
    expect(noFlagBody.adopted).toBe(false);
    expect(noFlagBody.adoptError).toBeUndefined();
    expect(noFlagBody.adoptWarning).toBeUndefined();
    expect(noFlagBody.driverMode).toBe('cli');

    const falseFlag = await postImport({ source: 'claude', sessionId: SESSION_ID, adopt: false });
    const falseFlagBody = (await falseFlag.json()) as ImportResponseBody;
    expect(falseFlag.status).toBe(201);
    expect(falseFlagBody.adopted).toBe(false);
    expect(existsSync(sidecarPath())).toBe(false);
  });
});
