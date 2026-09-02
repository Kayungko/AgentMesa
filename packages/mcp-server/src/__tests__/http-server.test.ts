import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext, registerAgent, grantMemberToken, revokeMemberToken } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import {
  startHttpServer,
  validateHttpServerOptions,
  adjudicateHttpActor,
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
  function setupCtxForBindRules(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:setup', type: 'user', roles: ['owner'] },
    });
  }

  it('recognizes loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('refuses a non-loopback bind without any auth credential', () => {
    expect(() => validateHttpServerOptions({ host: '0.0.0.0' })).toThrow(/without any auth credential/);
    expect(() => validateHttpServerOptions({ host: '192.168.1.10' })).toThrow(/without any auth credential/);
    // Loopback (the default) needs no token; non-loopback with one is fine.
    expect(() => validateHttpServerOptions({})).not.toThrow();
    expect(() => validateHttpServerOptions({ host: '0.0.0.0', token: 'x' })).not.toThrow();
  });

  it('startHttpServer refuses to start on a non-loopback host without a token or member tokens', async () => {
    await expect(
      startHttpServer(testDir, { host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow(/without any auth credential/);
  });

  it('a non-loopback bind is allowed when the workspace has an active member token', async () => {
    registerAgent(setupCtxForBindRules(), {
      id: 'agent:bot1',
      name: 'Bot One',
      client: 'remote',
      status: 'available',
      roles: ['builder'],
    });
    grantMemberToken(setupCtxForBindRules(), 'agent:bot1');

    // No shared token — the member token alone satisfies the non-loopback gate.
    expect(() => validateHttpServerOptions({ host: '0.0.0.0' }, testDir)).not.toThrow();

    // Revoking the only token re-arms the refusal.
    revokeMemberToken(setupCtxForBindRules(), 'agent:bot1');
    expect(() => validateHttpServerOptions({ host: '0.0.0.0' }, testDir)).toThrow(
      /without any auth credential/,
    );
  });
});

describe('HTTP actor adjudication (server-side role resolution)', () => {
  function setupCtx(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:setup', type: 'user', roles: ['owner'] },
    });
  }

  it('end-to-end: a registered id keeps registry roles even with a spoofed roles header', async () => {
    registerAgent(setupCtx(), {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });
    server = await startHttpServer(testDir, { port: 0 });
    const sid = await openSession(server.url, {
      [ACTOR_ID_HEADER]: 'agent:codex',
      [ACTOR_ROLES_HEADER]: 'owner',
    });
    expect(server.actorForSession(sid)?.roles).toEqual(['builder']);

    const createRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_task', { title: 'adjudicated write', createdBy: 'agent:codex' }),
      { 'mcp-session-id': sid },
    );
    expect(toolPayload(createRes.json).isError).toBeFalsy();
  });

  it('end-to-end: an unregistered id with a spoofed owner header is read-only', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    const sid = await openSession(server.url, {
      [ACTOR_ID_HEADER]: 'agent:ghost',
      [ACTOR_ROLES_HEADER]: 'owner',
    });
    expect(server.actorForSession(sid)?.roles).toEqual(['read_only']);

    const writeRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_task', { title: 'should fail', createdBy: 'agent:ghost' }),
      { 'mcp-session-id': sid },
    );
    expect(toolPayload(writeRes.json).isError).toBe(true);
    const readRes = await post(
      server.url,
      toolCallRequest(3, 'mesa_list_tasks', {}),
      { 'mcp-session-id': sid },
    );
    expect(toolPayload(readRes.json).isError).toBeFalsy();
  });

  it('end-to-end: bootstrap — a downgraded session self-registers, then a NEW session gains write access', async () => {
    server = await startHttpServer(testDir, { port: 0 });

    // First connection: unregistered → read-only, but can self-register.
    const boot = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:remote-bot' });
    expect(server.actorForSession(boot)?.roles).toEqual(['read_only']);
    const regRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_register_agent', {
        id: 'agent:remote-bot',
        name: 'Remote Bot',
        client: 'remote',
        roles: ['builder'],
      }),
      { 'mcp-session-id': boot },
    );
    expect(toolPayload(regRes.json).isError).toBeFalsy();

    // A NEW session with the same id adjudicates to the registered roles.
    const second = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:remote-bot' });
    expect(server.actorForSession(second)?.roles).toEqual(['builder']);
    const writeRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_task', { title: 'bootstrapped write', createdBy: 'agent:remote-bot' }),
      { 'mcp-session-id': second },
    );
    expect(toolPayload(writeRes.json).isError).toBeFalsy();
  });

  it('initialize result carries downgrade instructions for unregistered fallback ids', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    const res = await post(server.url, initializeRequest(1));
    const instructions = (res.json?.result as { instructions?: string }).instructions;
    expect(instructions).toContain('read-only');
    expect(instructions).toContain('mesa_register_agent');
  });

  it('forces the role-based engine for downgraded sessions even in a legacy allow-all workspace', async () => {
    // Simulate a pre-policy workspaces: config.json without a policy field
    // resolves to AllowAllMesaPolicyEngine.
    writeFileSync(
      join(testDir, '.agentmesa', 'config.json'),
      JSON.stringify({ protocolVersion: '0.2.0' }, null, 2),
      'utf-8',
    );
    server = await startHttpServer(testDir, { port: 0 });
    const sid = await openSession(server.url, { [ACTOR_ID_HEADER]: 'agent:legacy-ghost' });
    expect(server.actorForSession(sid)?.roles).toEqual(['read_only']);

    // The read-only downgrade must hold despite the allow-all config.
    const writeRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_task', { title: 'should still fail', createdBy: 'agent:legacy-ghost' }),
      { 'mcp-session-id': sid },
    );
    expect(toolPayload(writeRes.json).isError).toBe(true);
  });
});

describe('HTTP per-member tokens (M3 phase 2)', () => {
  function ownerCtx(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:setup', type: 'user', roles: ['owner'] },
    });
  }

  function registerBot1(): void {
    registerAgent(ownerCtx(), {
      id: 'agent:bot1',
      name: 'Bot One',
      client: 'remote',
      status: 'available',
      roles: ['builder'],
    });
  }

  it('a member token pins the identity (no header needed) and keeps registry roles', async () => {
    registerBot1();
    const { token } = grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0 });

    // No actor-id header at all — the token alone fixes who this is.
    const sid = await openSession(server.url, { authorization: `Bearer ${token}` });
    const actor = server.actorForSession(sid);
    expect(actor?.id).toBe('agent:bot1');
    expect(actor?.roles).toEqual(['builder']);

    const writeRes = await post(
      server.url,
      toolCallRequest(2, 'mesa_create_task', { title: 'member token write', createdBy: 'agent:bot1' }),
      { 'mcp-session-id': sid },
    );
    expect(toolPayload(writeRes.json).isError).toBeFalsy();
  });

  it('a matching actor-id header is accepted; a contradicting one is rejected with 400', async () => {
    registerBot1();
    const { token } = grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0 });

    const auth = { authorization: `Bearer ${token}` };
    const ok = await openSession(server.url, { ...auth, [ACTOR_ID_HEADER]: 'agent:bot1' });
    expect(server.actorForSession(ok)?.id).toBe('agent:bot1');

    // Someone presenting bot1's token while claiming to be bot2 → connection refused.
    const res = await post(
      server.url,
      initializeRequest(1),
      { ...auth, [ACTOR_ID_HEADER]: 'agent:bot2' },
    );
    expect(res.status).toBe(400);
    expect(res.json?.error?.message).toContain('contradicts the presented member token');
  });

  it('revocation takes effect on the very next request of an established session', async () => {
    registerBot1();
    const { token } = grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0 });

    const auth = { authorization: `Bearer ${token}` };
    const sid = await openSession(server.url, auth);

    // Revoke after the session is live — the session is not torn down, but…
    revokeMemberToken(ownerCtx(), 'agent:bot1');
    const res = await post(
      server.url,
      toolCallRequest(2, 'mesa_list_tasks', {}),
      { ...auth, 'mcp-session-id': sid },
    );
    // …its next request re-authenticates and now fails.
    expect(res.status).toBe(401);
  });

  it('dual-track: the shared token keeps working alongside member tokens', async () => {
    registerBot1();
    registerAgent(ownerCtx(), {
      id: 'agent:shared-user',
      name: 'Shared User',
      client: 'remote',
      status: 'available',
      roles: ['reviewer'],
    });
    grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0, token: 'shared-secret' });

    // Shared token + self-declared id → legacy header adjudication path.
    const sid = await openSession(server.url, {
      authorization: 'Bearer shared-secret',
      [ACTOR_ID_HEADER]: 'agent:shared-user',
    });
    expect(server.actorForSession(sid)?.id).toBe('agent:shared-user');
    expect(server.actorForSession(sid)?.roles).toEqual(['reviewer']);

    // The member token still works on the same server.
    const { token } = grantMemberToken(ownerCtx(), 'agent:bot1');
    const member = await openSession(server.url, { authorization: `Bearer ${token}` });
    expect(server.actorForSession(member)?.id).toBe('agent:bot1');
  });

  it('tightened loopback: a presented but invalid token is rejected even without a shared token', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    // Pre-member-token this was silently ignored (the gate was not armed).
    const res = await post(server.url, initializeRequest(1), {
      authorization: 'Bearer not-a-real-token',
    });
    expect(res.status).toBe(401);
  });

  it('initialize instructions note the token-locked identity', async () => {
    registerBot1();
    const { token } = grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0 });

    const res = await post(server.url, initializeRequest(1), {
      authorization: `Bearer ${token}`,
    });
    const instructions = (res.json?.result as { instructions?: string }).instructions;
    expect(instructions).toContain('locked to the member token');
  });

  it('rotate: the old token dies immediately, the new one works', async () => {
    registerBot1();
    const first = grantMemberToken(ownerCtx(), 'agent:bot1');
    server = await startHttpServer(testDir, { port: 0 });

    const second = grantMemberToken(ownerCtx(), 'agent:bot1');
    const dead = await post(server.url, initializeRequest(1), {
      authorization: `Bearer ${first.token}`,
    });
    expect(dead.status).toBe(401);

    const alive = await openSession(server.url, { authorization: `Bearer ${second.token}` });
    expect(server.actorForSession(alive)?.id).toBe('agent:bot1');
  });
});

describe('actor binding from connection headers', () => {
  let registryCtx: MesaRuntimeContext;

  beforeEach(() => {
    registryCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'system:http-adjudicator', type: 'system', roles: ['read_only'] },
    });
  });

  it('adjudicates roles from the registry for a registered id (header roles ignored)', () => {
    // Pre-register via an owner actor (the registry adjudication ctx itself
    // is deliberately minimal/read-only).
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:setup', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    const { actor, registered } = adjudicateHttpActor(
      registryCtx,
      { [ACTOR_ID_HEADER]: 'agent:codex', [ACTOR_ROLES_HEADER]: 'owner, admin' },
      '11111111-2222-3333-4444-555555555555',
    );
    expect(actor.id).toBe('agent:codex');
    // The self-declared owner/admin header must NOT be adopted.
    expect(actor.roles).toEqual(['reviewer']);
    expect(registered).toBe(true);
  });

  it('downgrades unregistered ids to read-only (never a shared default)', () => {
    const { actor, registered } = adjudicateHttpActor(
      registryCtx,
      { [ACTOR_ROLES_HEADER]: 'owner' },
      '11111111-2222-3333-4444-555555555555',
    );
    expect(actor.id).toBe('agent:http-11111111');
    expect(actor.roles).toEqual(['read_only']);
    expect(registered).toBe(false);
  });

  it('still rejects garbage roles headers loudly (they are not silently ignored)', () => {
    expect(() =>
      adjudicateHttpActor(
        registryCtx,
        { [ACTOR_ROLES_HEADER]: 'superadmin' },
        '11111111-2222-3333-4444-555555555555',
      ),
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

  it('returns the what/why/fix error envelope over the wire', async () => {
    server = await startHttpServer(testDir, { port: 0 });
    const sessionId = await openSession(server.url);

    const res = await post(
      server.url,
      toolCallRequest(2, 'mesa_read_task', { taskId: 'T-9999' }),
      { 'mcp-session-id': sessionId },
    );
    const payload = toolPayload(res.json);
    expect(payload.isError).toBe(true);
    const envelope = JSON.parse(payload.content[0]!.text) as {
      error: { tool: string; code: string; what: string; why: string; fix: string; message: string };
    };
    expect(envelope.error.tool).toBe('mesa_read_task');
    expect(envelope.error.code).toBe('unknown_id');
    expect(envelope.error.what).toContain('T-9999');
    expect(envelope.error.why.length).toBeGreaterThan(0);
    expect(envelope.error.fix).toContain('mesa_list_tasks');
    expect(envelope.error.message).toContain('Task not found');
  });

  it('maps an invalid actor-roles header to HTTP 400, not an internal error', async () => {
    server = await startHttpServer(testDir, { port: 0 });

    const res = await post(server.url, initializeRequest(1), {
      [ACTOR_ROLES_HEADER]: 'builder,not-a-role',
    });
    expect(res.status).toBe(400);
    expect(res.json?.error?.code).toBe(-32602);
    expect(res.json?.error?.message).toContain('Unknown agent role');
    // The rejected connection must not leave a session behind.
    expect(server.sessionCount).toBe(0);
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

    // Pre-register the operator id so its session adjudicates to real roles
    // (unregistered ids are downgraded to read-only since the M3 hardening).
    const setupCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:setup', type: 'user', roles: ['owner'] },
    });
    registerAgent(setupCtx, {
      id: 'agent:codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });

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
