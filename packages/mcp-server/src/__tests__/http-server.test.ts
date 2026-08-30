import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import {
  startHttpServer,
  validateHttpServerOptions,
  actorFromHeaders,
  isLoopbackHost,
  ACTOR_ID_HEADER,
  ACTOR_ROLES_HEADER,
} from '../http-server.js';
import { parseServerConfig } from '../config.js';
import type { HttpServerHandle } from '../http-server.js';

let testDir: string;
let homeDir: string;
const prevHome = process.env['AGENTMESA_HOME'];
let server: HttpServerHandle | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-http-mcp-'));
  initWorkspace(testDir);
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-http-home-'));
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(testDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; json: JsonRpcResponse | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The streamable HTTP spec requires the client to accept both.
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text === '' ? null : (JSON.parse(text) as JsonRpcResponse),
  };
}

function initializeRequest(id: number) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'agentmesa-test-client', version: '1.0' },
    },
  };
}

function toolCallRequest(id: number, name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function toolPayload(response: JsonRpcResponse | null): ToolResult {
  expect(response?.error).toBeUndefined();
  return response!.result as ToolResult;
}

function toolJson<T>(response: JsonRpcResponse | null): T {
  return JSON.parse(toolPayload(response).content[0]!.text) as T;
}

async function openSession(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await post(url, initializeRequest(1), headers);
  expect(res.status).toBe(200);
  expect(res.json?.error).toBeUndefined();
  const serverInfo = (res.json?.result as { serverInfo?: { name?: string } }).serverInfo;
  expect(serverInfo?.name).toBe('agentmesa');
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

describe('http server bind rules (local-first isolation)', () => {
  it('recognizes loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('refuses a non-loopback bind without a token', () => {
    expect(() => validateHttpServerOptions({ host: '0.0.0.0' })).toThrow(/without a token/);
    expect(() => validateHttpServerOptions({ host: '192.168.1.10' })).toThrow(/without a token/);
    // Loopback (the default) needs no token; non-loopback with one is fine.
    expect(() => validateHttpServerOptions({})).not.toThrow();
    expect(() => validateHttpServerOptions({ host: '0.0.0.0', token: 'x' })).not.toThrow();
  });

  it('startHttpServer refuses to start on a non-loopback host without a token', async () => {
    await expect(
      startHttpServer(testDir, { host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow(/without a token/);
  });
});

describe('actor binding from connection headers', () => {
  it('uses the actor id and roles headers', () => {
    const actor = actorFromHeaders(
      { [ACTOR_ID_HEADER]: 'agent:codex', [ACTOR_ROLES_HEADER]: 'reviewer, builder' },
      '11111111-2222-3333-4444-555555555555',
    );
    expect(actor.id).toBe('agent:codex');
    expect(actor.roles).toEqual(['reviewer', 'builder']);
    expect(actor.client).toBe('mcp-http');
  });

  it('falls back to a connection-scoped actor id (never a shared default)', () => {
    const actor = actorFromHeaders({}, '11111111-2222-3333-4444-555555555555');
    expect(actor.id).toBe('agent:http-11111111');
    expect(actor.roles).toEqual(['builder']);
  });

  it('rejects unknown roles', () => {
    expect(() =>
      actorFromHeaders({ [ACTOR_ROLES_HEADER]: 'superadmin' }, '11111111-2222-3333-4444-555555555555'),
    ).toThrow(/Unknown agent role/);
  });
});

describe('http server transport', () => {
  it('serves initialize + tool calls over a single POST endpoint', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    const sessionId = await openSession(server.url);
    expect(server.sessionCount).toBe(1);

    const listed = await post(
      server.url,
      toolCallRequest(2, 'mesa_list_agents', {}),
      { 'mcp-session-id': sessionId },
    );
    expect(listed.status).toBe(200);
    expect(listed.json?.error).toBeUndefined();
    expect(Array.isArray(toolJson<unknown[]>(listed.json))).toBe(true);
  });

  it('binds a distinct actor per connection', async () => {
    server = await startHttpServer(testDir, { port: 0 });

    const codexSession = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:codex' });
    const claudeSession = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:claude' });
    expect(server.actorForSession(codexSession)?.id).toBe('agent:codex');
    expect(server.actorForSession(claudeSession)?.id).toBe('agent:claude');

    // mesa_poll_rooms only accepts the caller's own ref: each session's actor
    // decides which ref is legal, proving the binding is per-connection.
    const own = await post(
      server.url,
      toolCallRequest(2, 'mesa_poll_rooms', { ref: 'codex' }),
      { 'mcp-session-id': codexSession },
    );
    expect(toolPayload(own.json).isError).toBeFalsy();

    const other = await post(
      server.url,
      toolCallRequest(2, 'mesa_poll_rooms', { ref: 'codex' }),
      { 'mcp-session-id': claudeSession },
    );
    expect(toolPayload(other.json).isError).toBe(true);
    expect(toolPayload(other.json).content[0]!.text).toContain('does not match actor');
  });

  it('rejects requests for unknown sessions and non-initialize POSTs without a session', async () => {
    server = await startHttpServer(testDir, { port: 0 });

    const unknown = await post(server.url, initializeRequest(1), {
      'mcp-session-id': 'no-such-session',
    });
    expect(unknown.status).toBe(404);

    const noSession = await post(server.url, toolCallRequest(1, 'mesa_list_agents', {}));
    expect(noSession.status).toBe(400);
  });

  it('terminates a session on DELETE', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    const sessionId = await openSession(server.url);

    const res = await fetch(server.url, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    expect(res.status).toBe(200);
    expect(server.sessionCount).toBe(0);

    const after = await post(server.url, toolCallRequest(2, 'mesa_list_agents', {}), {
      'mcp-session-id': sessionId,
    });
    expect(after.status).toBe(404);
  });

  it('supports remote member registration end-to-end: room + remote actor conversation', async () => {
    server = await startHttpServer(testDir, { port: 0 });

    // Operator session creates the room and registers the remote member.
    const operator = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:codex' });
    const roomRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_room', { name: '跨机房协作群' }),
      { 'mcp-session-id': operator },
    );
    const room = toolJson<{ id: string }>(roomRes.json);
    expect(room.id).toMatch(/^room_/);

    const registerRes = await post(
      server.url,
      toolCallRequest(3, 'mesa_register_remote_member', {
        id: 'remote-bot',
        name: 'Remote Bot',
        roles: ['reviewer'],
        roomId: room.id,
      }),
      { 'mcp-session-id': operator },
    );
    const registered = toolJson<{ agent: { id: string; client: string }; room: { members: unknown[] } }>(registerRes.json);
    expect(registered.agent.client).toBe('remote');
    expect(registered.room.members).toHaveLength(1);

    // The remote agent connects with its own actor and speaks in the room.
    const remote = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:remote-bot' });
    const sendRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_send_room_message', {
        roomId: room.id,
        workspaceId: 'remote',
        fromKind: 'agent',
        fromRef: 'remote-bot',
        fromLabel: 'Remote Bot',
        summary: '来自远端的第一条消息',
      }),
      { 'mcp-session-id': remote },
    );
    const sent = toolJson<{ summary: string; from: { ref: string } }>(sendRes.json);
    expect(sent.summary).toBe('来自远端的第一条消息');
    expect(sent.from.ref).toBe('remote-bot');

    // Impersonation still guarded: the operator session cannot post as the
    // remote member.
    const spoof = await post(
      server.url,
      toolCallRequest(4, 'mesa_send_room_message', {
        roomId: room.id,
        workspaceId: 'remote',
        fromKind: 'agent',
        fromRef: 'remote-bot',
        summary: '冒充远端成员',
      }),
      { 'mcp-session-id': operator },
    );
    expect(toolPayload(spoof.json).isError).toBe(true);
    expect(toolPayload(spoof.json).content[0]!.text).toContain('impersonation rejected');
  });
});

describe('http token authentication', () => {
  it('rejects connections without a valid bearer token when a token is configured', async () => {
    const token = randomUUID();
    server = await startHttpServer(testDir, { port: 0, token });

    const noToken = await post(server.url, initializeRequest(1));
    expect(noToken.status).toBe(401);
    expect(server.sessionCount).toBe(0);

    const wrongToken = await post(server.url, initializeRequest(1), {
      authorization: `Bearer ${randomUUID()}`,
    });
    expect(wrongToken.status).toBe(401);
    expect(server.sessionCount).toBe(0);

    const ok = await post(server.url, initializeRequest(1), {
      authorization: `Bearer ${token}`,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('mcp-session-id')).toBeTruthy();
    expect(server.sessionCount).toBe(1);

    // Even a valid session cannot bypass the per-request token gate.
    const sessionId = ok.headers.get('mcp-session-id')!;
    const unauthenticatedCall = await post(
      server.url,
      toolCallRequest(2, 'mesa_list_agents', {}),
      { 'mcp-session-id': sessionId },
    );
    expect(unauthenticatedCall.status).toBe(401);
  });
});

describe('parseServerConfig', () => {
  it('defaults to stdio on 127.0.0.1 without a token', () => {
    const config = parseServerConfig([], {});
    expect(config.transport).toBe('stdio');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8765);
    expect(config.token).toBeUndefined();
  });

  it('reads CLI flags with precedence over the environment', () => {
    const config = parseServerConfig(
      ['--transport', 'http', '--host', '0.0.0.0', '--port=9000', '--token', 'abc'],
      { AGENTMESA_HTTP_HOST: '127.0.0.1', AGENTMESA_HTTP_TOKEN: 'env-token' },
    );
    expect(config).toEqual({
      transport: 'http',
      host: '0.0.0.0',
      port: 9000,
      token: 'abc',
    });
  });

  it('reads the environment when no flags are given', () => {
    const config = parseServerConfig([], {
      AGENTMESA_MCP_TRANSPORT: 'http',
      AGENTMESA_HTTP_PORT: '9100',
      AGENTMESA_HTTP_TOKEN: 'env-token',
    });
    expect(config.transport).toBe('http');
    expect(config.port).toBe(9100);
    expect(config.token).toBe('env-token');
  });

  it('rejects invalid transports and ports', () => {
    expect(() => parseServerConfig(['--transport', 'grpc'], {})).toThrow(/Invalid transport/);
    expect(() => parseServerConfig([], { AGENTMESA_HTTP_PORT: 'not-a-port' })).toThrow(/Invalid HTTP port/);
  });
});
