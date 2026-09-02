import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NESTED_SESSION_ID = '11111111-2222-3333-4444-555555555555';
/** Runner 包的 mock codex app-server（预检端点的 codex 实测探测用）。 */
const MOCK_CODEX_SERVER = fileURLToPath(
  new URL('../../../runner/src/drivers/__tests__/fixtures/mock-codex-app-server.mjs', import.meta.url),
);

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
      uuid: 'u-1',
      cwd: 'E:\\FakeRepo',
      timestamp: '2026-08-01T10:00:00.000Z',
      message: { content: '帮我修登录 bug' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a-1',
      timestamp: '2026-08-01T10:00:05.000Z',
      message: { content: [{ type: 'text', text: '我来看一下 auth 模块' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a-2',
      timestamp: '2026-08-01T10:00:06.000Z',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'auth.ts' } }] },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'u-2',
      timestamp: '2026-08-01T10:00:07.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export function login() {}' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a-3',
      timestamp: '2026-08-01T10:00:08.000Z',
      message: { content: [{ type: 'thinking', thinking: '内部推理，不应导入' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a-4',
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

  // --- Snapshot freshness: imported / hasUpdates / refresh ---

  it('POST /api/imports/precheck validates source and sessionId', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const badSource = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'bogus', sessionId: SESSION_ID }),
    }));
    expect(badSource.status).toBe(400);

    const badSession = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: '' }),
    }));
    expect(badSession.status).toBe(400);
  });

  it('POST /api/imports/precheck probes claude transcripts (found / missing)', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const okRes = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: SESSION_ID }),
    }));
    const ok = (await okRes.json()) as {
      adoptable: boolean;
      checks: Array<{ name: string; ok: boolean }>;
      warnings: string[];
    };
    expect(okRes.status).toBe(200);
    expect(ok.adoptable).toBe(true);
    expect(ok.checks).toEqual([{ name: 'transcript', ok: true, detail: expect.any(String) }]);
    expect(Array.isArray(ok.warnings)).toBe(true);

    const missingRes = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude', sessionId: 'no-such-session' }),
    }));
    const missing = (await missingRes.json()) as { adoptable: boolean };
    expect(missingRes.status).toBe(200);
    expect(missing.adoptable).toBe(false);
  });

  it('POST /api/imports/precheck live-probes codex resume and reports failure gracefully', async () => {
    const prevCmd = process.env.AGENTMESA_CODEX_APP_SERVER_CMD;
    try {
      // 可用命令 + mock app-server：resume 探测成功。
      process.env.AGENTMESA_CODEX_APP_SERVER_CMD = `node ${MOCK_CODEX_SERVER}`;
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();

      const okRes = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'codex', sessionId: 'thr_precheck_1' }),
      }));
      const ok = (await okRes.json()) as {
        adoptable: boolean;
        checks: Array<{ name: string; ok: boolean }>;
        warnings: string[];
      };
      expect(okRes.status).toBe(200);
      expect(ok.adoptable).toBe(true);
      expect(ok.checks.map((check) => check.name)).toEqual(['command', 'resume']);
      expect(Array.isArray(ok.warnings)).toBe(true);

      // 不可用命令：command 检查失败，端点不 5xx。
      await server.stop();
      process.env.AGENTMESA_CODEX_APP_SERVER_CMD = 'definitely-missing-codex-binary-xyz';
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();

      const badRes = await fetch(`${baseUrl()}/api/imports/precheck`, authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'codex', sessionId: 'thr_precheck_2' }),
      }));
      const bad = (await badRes.json()) as {
        adoptable: boolean;
        checks: Array<{ name: string; ok: boolean }>;
      };
      expect(badRes.status).toBe(200);
      expect(bad.adoptable).toBe(false);
      expect(bad.checks).toEqual([{ name: 'command', ok: false, detail: expect.any(String) }]);
    } finally {
      if (prevCmd === undefined) delete process.env.AGENTMESA_CODEX_APP_SERVER_CMD;
      else process.env.AGENTMESA_CODEX_APP_SERVER_CMD = prevCmd;
    }
  }, 60_000);

  it('POST /api/meetings/import stamps groupName into the meeting title and metadata', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await postImport({ source: 'claude', sessionId: SESSION_ID, groupName: '总控接管' });
    const body = (await res.json()) as ImportResponseBody & { meetingId: string };

    expect(res.status).toBe(201);
    const meetingRes = await fetch(`${baseUrl()}/api/meetings/${body.meetingId}`, authed());
    const meeting = (await meetingRes.json()) as { title: string; metadata: { groupName?: string } };
    expect(meeting.title).toBe('[总控接管] 修登录 bug');
    expect(meeting.metadata?.groupName).toBe('总控接管');
  });

  it('GET /api/imports/external-sessions annotates imported sessions and source updates', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    // Before importing: no session carries import state.
    const before = await (await fetch(`${baseUrl()}/api/imports/external-sessions?source=claude`, authed())).json() as {
      sessions: Array<{ sessionId: string; imported?: unknown; hasUpdates?: unknown }>;
    };
    expect(before.sessions.find((entry) => entry.sessionId === SESSION_ID)?.imported).toBeUndefined();

    const importRes = await postImport({ source: 'claude', sessionId: SESSION_ID });
    const { meetingId } = (await importRes.json()) as ImportResponseBody;

    // Fresh snapshot: imported, no updates.
    const fresh = await (await fetch(`${baseUrl()}/api/imports/external-sessions?source=claude`, authed())).json() as {
      sessions: Array<{ sessionId: string; imported?: { meetingId: string }; hasUpdates?: boolean }>;
    };
    const freshEntry = fresh.sessions.find((entry) => entry.sessionId === SESSION_ID);
    expect(freshEntry?.imported).toEqual({ meetingId });
    expect(freshEntry?.hasUpdates).toBeUndefined();

    // The external conversation continues → mtime/size drift from the anchors.
    const transcript = join(claudeRoot, 'E--FakeRepo', `${SESSION_ID}.jsonl`);
    writeFileSync(
      transcript,
      `${readFileSync(transcript, 'utf-8')}${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-01T12:00:00.000Z',
        message: { content: [{ type: 'text', text: '后续追问的回复' }] },
      })}\n`,
      'utf-8',
    );

    const stale = await (await fetch(`${baseUrl()}/api/imports/external-sessions?source=claude`, authed())).json() as {
      sessions: Array<{ sessionId: string; imported?: { meetingId: string }; hasUpdates?: boolean }>;
    };
    const staleEntry = stale.sessions.find((entry) => entry.sessionId === SESSION_ID);
    expect(staleEntry?.imported).toEqual({ meetingId });
    expect(staleEntry?.hasUpdates).toBe(true);
  });

  it('POST /api/meetings/:id/refresh re-imports the source snapshot', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const importRes = await postImport({ source: 'claude', sessionId: SESSION_ID });
    const { meetingId } = (await importRes.json()) as ImportResponseBody;

    // The external conversation continues after the snapshot was taken.
    const transcript = join(claudeRoot, 'E--FakeRepo', `${SESSION_ID}.jsonl`);
    writeFileSync(
      transcript,
      `${readFileSync(transcript, 'utf-8')}${JSON.stringify({
        type: 'assistant',
        uuid: 'a-99',
        timestamp: '2026-08-01T12:00:00.000Z',
        message: { content: [{ type: 'text', text: '续跑补充回复' }] },
      })}\n`,
      'utf-8',
    );

    const refreshRes = await fetch(`${baseUrl()}/api/meetings/${meetingId}/refresh`, authed({ method: 'POST' }));
    const refreshBody = (await refreshRes.json()) as { meetingId: string; messageCount: number };

    expect(refreshRes.status).toBe(200);
    expect(refreshBody.meetingId).toBe(meetingId);
    // 5 original + 1 new message; no stale duplicates.
    expect(refreshBody.messageCount).toBe(6);

    const meetingRes = await fetch(`${baseUrl()}/api/meetings/${meetingId}`, authed());
    const meeting = (await meetingRes.json()) as {
      messages: Array<{ summary: string }>;
      metadata: { refreshedAt?: string };
    };
    expect(meeting.messages).toHaveLength(6);
    expect(meeting.messages.some((message) => message.summary === '续跑补充回复')).toBe(true);
    expect(meeting.metadata?.refreshedAt).toBeTruthy();

    // Refreshing a non-import meeting is rejected.
    const created = await fetch(`${baseUrl()}/api/meetings`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '普通会议' }),
    }));
    const plainMeeting = (await created.json()) as { id: string };
    const rejected = await fetch(`${baseUrl()}/api/meetings/${plainMeeting.id}/refresh`, authed({ method: 'POST' }));
    expect(rejected.status).toBe(400);
  });

  it('POST refresh defaults to incremental and honors {"mode":"replace"}', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const importRes = await postImport({ source: 'claude', sessionId: SESSION_ID });
    const { meetingId } = (await importRes.json()) as ImportResponseBody;

    const incremental = await fetch(`${baseUrl()}/api/meetings/${meetingId}/refresh`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    const incrementalBody = (await incremental.json()) as { mode?: string };
    expect(incremental.status).toBe(200);
    expect(incrementalBody.mode).toBe('incremental');

    const replace = await fetch(`${baseUrl()}/api/meetings/${meetingId}/refresh`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace' }),
    }));
    const replaceBody = (await replace.json()) as { mode?: string; appendedCount?: number };
    expect(replace.status).toBe(200);
    expect(replaceBody.mode).toBe('replace');
    expect(replaceBody.appendedCount).toBe(5);

    // An invalid mode value falls back to incremental (lenient parsing).
    const fallback = await fetch(`${baseUrl()}/api/meetings/${meetingId}/refresh`, authed({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'x' }),
    }));
    const fallbackBody = (await fallback.json()) as { mode?: string };
    expect(fallback.status).toBe(200);
    expect(fallbackBody.mode).toBe('incremental');
  });
});
