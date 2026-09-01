import { describe, it, expect, afterEach, vi } from 'vitest';
import { importExternalSession, listExternalSessions, previewExternalSession } from '../api.js';
import type { RuntimeConfig } from '../types.js';

const config: RuntimeConfig = { baseUrl: 'http://127.0.0.1:3456', token: 'secret', view: 'widget' };

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('external session import API bindings', () => {
  it('listExternalSessions GETs /api/imports/external-sessions with the source query', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        sessions: [
          {
            source: 'claude',
            sessionId: 'proj/abc',
            title: '登录重构',
            projectDir: 'E:\\AgentMesa',
            lastModified: '2026-08-31T00:00:00.000Z',
            sizeBytes: 2048,
            active: true,
          },
        ],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listExternalSessions(config, 'claude');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/imports/external-sessions?source=claude');
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sessionId: 'proj/abc', title: '登录重构', active: true });
  });

  it('previewExternalSession POSTs previewOnly and unwraps the preview array', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        meetingId: null,
        preview: [
          { speaker: 'user', text: '帮我看看登录模块', createdAt: '2026-08-31T00:00:00.000Z', kind: 'text' },
          { speaker: 'assistant', text: '{"name":"Read","input":{"path":"a.ts"}}', createdAt: '2026-08-31T00:00:01.000Z', kind: 'tool_use' },
        ],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await previewExternalSession(config, 'codex', 'sess/1');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/meetings/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ source: 'codex', sessionId: 'sess/1', previewOnly: true });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: 'tool_use', speaker: 'assistant' });
  });

  it('importExternalSession POSTs the import and returns the meeting id', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ meetingId: 'mtg_imported', messageCount: 42 }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await importExternalSession(config, 'claude', 'proj/abc');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/meetings/import');
    expect(JSON.parse(init.body as string)).toEqual({ source: 'claude', sessionId: 'proj/abc' });
    expect(result).toEqual({ meetingId: 'mtg_imported', messageCount: 42 });
  });

  it('importExternalSession passes adopt:true through to the body when requested', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        meetingId: 'mtg_adopted',
        messageCount: 7,
        adopted: true,
        driverMode: 'cli',
        adoptWarning: 'AGENTMESA_SESSION_DRIVER=cli，接管句柄不会生效',
      }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await importExternalSession(config, 'claude', 'proj/abc', true);

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ source: 'claude', sessionId: 'proj/abc', adopt: true });
    expect(result).toMatchObject({ meetingId: 'mtg_adopted', messageCount: 7, adopted: true, driverMode: 'cli' });
    expect(result.adoptWarning).toContain('cli');
  });

  it('importExternalSession surfaces adopt failures without failing the import result', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        meetingId: 'mtg_degraded',
        messageCount: 3,
        adopted: false,
        adoptError: 'no Claude transcript "ghost.jsonl" found',
        driverMode: 'auto',
      }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await importExternalSession(config, 'codex', 'sess/9', true);

    expect(result).toMatchObject({
      meetingId: 'mtg_degraded',
      messageCount: 3,
      adopted: false,
      adoptError: 'no Claude transcript "ghost.jsonl" found',
      driverMode: 'auto',
    });
  });

  it('importExternalSession surfaces the server error message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'External session not found: ghost' }), { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(importExternalSession(config, 'claude', 'ghost')).rejects.toThrow('External session not found: ghost');
  });

  it('listExternalSessions throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listExternalSessions(config, 'codex')).rejects.toThrow('Desk request failed (500)');
  });
});
