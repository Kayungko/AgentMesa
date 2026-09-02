import { describe, it, expect, afterEach, vi } from 'vitest';
import { listPendingPermissions, decidePermission } from '../api.js';
import type { RuntimeConfig } from '../types.js';

const config: RuntimeConfig = { baseUrl: 'http://127.0.0.1:3456', token: 'secret', view: 'widget' };

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
});

describe('permission approval API bindings', () => {
  it('listPendingPermissions GETs /api/permissions/pending with the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pending: [{ id: 'req_1', kind: 'command', title: 'bash: rm -rf build/', requestedAt: '2026-08-30T00:00:00.000Z' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listPendingPermissions(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/permissions/pending');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toMatchObject({ id: 'req_1', kind: 'command' });
    vi.unstubAllGlobals();
  });

  it('decidePermission POSTs the decision to /api/permissions/:id/decide', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await decidePermission(config, 'req/1', 'deny');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/permissions/req%2F1/decide');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'deny' });
    expect(result).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it('decidePermission surfaces the server error for an unknown id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unknown permission request: ghost' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(decidePermission(config, 'ghost', 'allow')).rejects.toThrow('Unknown permission request: ghost');
    vi.unstubAllGlobals();
  });

  it('decidePermission passes allow_session through to the body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await decidePermission(config, 'req_9', 'allow_session');

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'allow_session' });
    vi.unstubAllGlobals();
  });
});
