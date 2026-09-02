import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { agentRoleSchema } from '@agentmesa/protocol';
import { MesaError, createRuntimeContext, getAgent, actorRefOf, findMemberToken, listMemberTokens } from '@agentmesa/core';
import type { MesaActor, MesaRuntimeContext } from '@agentmesa/core';
import { createMcpServer } from './server.js';

/**
 * MCP Streamable HTTP transport (M3 Broad Access).
 *
 * Single-endpoint POST (+ optional standalone GET SSE stream, DELETE to end a
 * session), following the MCP Streamable HTTP transport specification — the
 * SDK's `StreamableHTTPServerTransport` implements the wire protocol; this
 * module owns the surrounding policy:
 *
 * - **Per-connection actor binding.** Every session gets its own
 *   `McpServer` instance whose actor is read from the connection's
 *   initialize-time headers — never the shared env-derived actor.
 * - **Local-first isolation.** The listener defaults to 127.0.0.1. Binding a
 *   non-loopback host requires an auth credential (shared token or at least
 *   one active member token); requests must then carry it.
 * - **Per-member tokens (M3 phase 2).** Agents may hold individual tokens
 *   (`.agentmesa/tokens/`, granted by owner/admin via `mesa token grant`).
 *   A member token fixes the identity — the actor id it maps to cannot be
 *   overridden by headers — while roles are still adjudicated from the agent
 *   registry on every connection. The legacy shared token keeps working
 *   unchanged (dual-track).
 */

/** Header carrying the actor id for a connection (read once, at initialize). */
export const ACTOR_ID_HEADER = 'x-agentmesa-actor-id';
/** Header carrying the comma-separated actor roles (read once, at initialize). */
export const ACTOR_ROLES_HEADER = 'x-agentmesa-actor-roles';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** True when the host only accepts local connections. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export interface HttpServerOptions {
  /** Bind address. Default `127.0.0.1`. */
  host?: string;
  /** Bind port. Default 8765. Pass 0 for an ephemeral port (tests). */
  port?: number;
  /**
   * Bearer token required on every request. Required (refuses to start) when
   * the host is not loopback; optional on loopback.
   */
  token?: string;
  /** Endpoint path. Default `/mcp`. */
  endpoint?: string;
}

/**
 * Local-first isolation rule: a non-loopback bind must present an auth
 * credential, or the server refuses to start. A shared token (--token /
 * AGENTMESA_HTTP_TOKEN) or at least one active member token in the workspace
 * both satisfy the gate. An empty/whitespace token counts as absent.
 */
export function validateHttpServerOptions(options: HttpServerOptions, rootDir?: string): void {
  const host = options.host ?? '127.0.0.1';
  const token = options.token?.trim();
  if (!isLoopbackHost(host) && !token) {
    const hasMemberTokens =
      rootDir !== undefined &&
      listMemberTokens(
        createRuntimeContext({
          rootDir,
          actor: { id: 'system:http-validator', type: 'system', roles: ['read_only'] },
        }),
      ).some((t) => !t.revokedAt);
    if (!hasMemberTokens) {
      throw new MesaError(
        'VALIDATION_ERROR',
        `Refusing to bind HTTP server to non-loopback host "${host}" without any auth credential. ` +
          'Provide a shared token (--token / AGENTMESA_HTTP_TOKEN), grant at least one member token ' +
          '("mesa token grant <agentId>"), or bind 127.0.0.1.',
      );
    }
  }
}

function bearerTokenFromRequest(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Constant-time comparison so tokens cannot be probed byte-by-byte. */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Returns true when the request is authorized under the configured token. */
export function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  const expected = token?.trim();
  if (!expected) return true;
  const presented = bearerTokenFromRequest(req);
  if (presented === null) return false;
  return tokensMatch(presented, expected);
}

/**
 * How a request authenticated (M3 phase 2, option B — per-member tokens).
 *
 * - `member`: a per-agent token matched — the identity is fixed to that agent
 *   and cannot be overridden by the actor-id header.
 * - `shared`: the legacy shared token matched — identity falls back to
 *   header self-declaration + registry adjudication (unchanged behavior).
 * - `anonymous`: loopback only, no shared token configured, nothing
 *   presented — the pre-existing local-first default.
 */
export type HttpAuthIdentity =
  | { kind: 'member'; agentId: string }
  | { kind: 'shared' }
  | { kind: 'anonymous' };

/**
 * Unified request authentication. Returns `null` when the request must be
 * rejected with 401. Precedence:
 *
 * 1. no Authorization header → allowed only when there is no gate at all
 *    (loopback, no shared token configured) — `anonymous`;
 * 2. presented token equals the shared token (when one is configured) → `shared`;
 * 3. presented token resolves to a non-revoked member token → `member`;
 * 4. anything else → `null` (401).
 *
 * Note the deliberate tightening vs. the pre-member-token era: on loopback
 * without a shared token, a *presented but invalid* token used to be ignored
 * (the gate simply was not armed). It now 401s — anyone actively presenting
 * credentials should get a truthful verdict, and this closes accidental
 * misconfiguration ("member token revoked, client still sends it") from
 * silently downgrading to anonymous-loopback access.
 */
export function authenticateRequest(
  req: IncomingMessage,
  sharedToken: string | undefined,
  tokenCtx: MesaRuntimeContext,
  loopback: boolean,
): HttpAuthIdentity | null {
  const expected = sharedToken?.trim();
  const presented = bearerTokenFromRequest(req);

  if (presented === null) {
    if (expected) return null;
    // No shared-token gate. Loopback keeps the anonymous local-first default.
    // Non-loopback without a shared token means member tokens are the only
    // credential — an anonymous request has then presented nothing and is
    // rejected (validateHttpServerOptions guarantees the bind is not naked).
    return loopback ? { kind: 'anonymous' } : null;
  }

  if (expected && tokensMatch(presented, expected)) {
    return { kind: 'shared' };
  }

  const member = findMemberToken(tokenCtx, presented);
  if (member) {
    return { kind: 'member', agentId: member.agentId };
  }

  return null;
}

/**
 * Adjudicate the per-connection actor at initialize time (M3 identity
 * hardening, 2026-09-03; per-member tokens 2026-09).
 *
 * - id: `x-agentmesa-actor-id`, or a connection-scoped fallback
 *   `agent:http-<sessionId prefix>` when absent — unique per connection, so
 *   two clients never share an actor by accident.
 * - **token identity wins (when the connection authenticated with a member
 *   token):** the actor id is pinned to the token's agent. A header id that
 *   disagrees (prefix-normalized) is rejected with a 400 — that is someone
 *   presenting bot1's token while claiming to be bot2, exactly the
 *   impersonation this phase closes. Without the header, the token alone
 *   fixes the identity (that is its point).
 * - roles: **never trusted from the wire.** The agent registry is the single
 *   source of truth: a registered id gets its registered roles, an
 *   unregistered id is downgraded to `read_only` (the session can still
 *   bootstrap itself via `mesa_register_agent` self-registration). The
 *   `x-agentmesa-actor-roles` header is still enum-validated so garbage fails
 *   loudly with a 400 instead of being silently ignored, but its values are
 *   not adopted. This holds for member-token connections too: the token fixes
 *   WHO you are, the registry fixes WHAT you may do.
 */
export function adjudicateHttpActor(
  registryCtx: MesaRuntimeContext,
  headers: IncomingMessage['headers'],
  sessionId: string,
  tokenIdentity?: HttpAuthIdentity,
): { actor: MesaActor; registered: boolean; tokenLocked: boolean } {
  const headerId = firstHeaderValue(headers, ACTOR_ID_HEADER)?.trim();

  let id = headerId && headerId.length > 0 ? headerId : `agent:http-${sessionId.slice(0, 8)}`;
  let tokenLocked = false;

  if (tokenIdentity?.kind === 'member') {
    if (headerId && actorRefOf(headerId) !== actorRefOf(tokenIdentity.agentId)) {
      throw new MesaError(
        'VALIDATION_ERROR',
        `Actor id "${headerId}" contradicts the presented member token (locked to "${tokenIdentity.agentId}"). ` +
          'The token fixes the connection identity; reconnect with the matching actor id or without the header.',
      );
    }
    id = tokenIdentity.agentId;
    tokenLocked = true;
  }

  const rolesHeader = firstHeaderValue(headers, ACTOR_ROLES_HEADER)?.trim();
  if (rolesHeader) {
    const requested = rolesHeader.split(',').map((r) => r.trim()).filter(Boolean);
    for (const role of requested) {
      if (!agentRoleSchema.safeParse(role).success) {
        throw new MesaError(
          'VALIDATION_ERROR',
          `Unknown agent role "${role}" in ${ACTOR_ROLES_HEADER}. Note: roles are adjudicated server-side from the agent registry; this header is not trusted.`,
        );
      }
    }
  }

  // Registry lookup tries the id as given and its normalized ref (remote
  // members are registered under the bare ref, e.g. "remote-bot", while the
  // connection header carries "agent:remote-bot").
  for (const candidate of new Set([id, actorRefOf(id)])) {
    try {
      const roles = getAgent(registryCtx, candidate).roles;
      return { actor: { id, type: 'agent', roles, client: 'mcp-http' }, registered: true, tokenLocked };
    } catch {
      // try the next form
    }
  }
  return { actor: { id, type: 'agent', roles: ['read_only'], client: 'mcp-http' }, registered: false, tokenLocked };
}

/** Build the per-session initialize `instructions` so clients can see their adjudicated identity. */
export function sessionInstructions(actor: MesaActor, registered: boolean, tokenLocked = false): string {
  const lockNote = tokenLocked ? ' Your identity is locked to the member token you presented.' : '';
  if (registered) {
    return `Connected as ${actor.id} (roles: ${actor.roles.join(', ')}, adjudicated from the agent registry).${lockNote}`;
  }
  return (
    `Connected as ${actor.id} — this id is not registered, so the session is downgraded to read-only. ` +
    'Roles declared in headers are not trusted. To gain write access, call mesa_register_agent to register ' +
    'your own id with non-privileged roles (self-registration bootstrap), then reconnect.' +
    lockNote
  );
}

function firstHeaderValue(
  headers: IncomingMessage['headers'],
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  actor: MesaActor;
}

export interface HttpServerHandle {
  host: string;
  port: number;
  url: string;
  /** Number of currently open MCP sessions. */
  readonly sessionCount: number;
  /** The actor bound to a session (test/diagnostic helper). */
  actorForSession(sessionId: string): MesaActor | undefined;
  close(): Promise<void>;
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

function isInitializeMessage(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (m) => typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'initialize',
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return undefined;
  return JSON.parse(raw) as unknown;
}

/**
 * Start the MCP streamable HTTP server. Resolves once the listener is ready;
 * the returned handle exposes the bound address and a `close()` that ends all
 * sessions.
 */
export async function startHttpServer(
  rootDir: string,
  options: HttpServerOptions = {},
): Promise<HttpServerHandle> {
  validateHttpServerOptions(options, rootDir);

  const host = options.host ?? '127.0.0.1';
  const endpoint = options.endpoint ?? '/mcp';
  const token = options.token?.trim() || undefined;
  const loopback = isLoopbackHost(host);
  const sessions = new Map<string, HttpSession>();
  // Registry adjudication context: `getAgent` / `findMemberToken` perform no
  // policy assertion (pure storage reads), so a minimal read-only system
  // actor is enough.
  const registryCtx = createRuntimeContext({
    rootDir,
    actor: { id: 'system:http-adjudicator', type: 'system', roles: ['read_only'] },
  });

  function createSession(req: IncomingMessage, identity: HttpAuthIdentity): { session: HttpSession; sessionId: string } {
    const sessionId = randomUUID();
    const { actor, registered, tokenLocked } = adjudicateHttpActor(
      registryCtx,
      req.headers,
      sessionId,
      identity,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      // Plain JSON request/response over a single POST endpoint. SSE streaming
      // stays available via the spec's optional GET stream; we do not need it
      // for tool call/response semantics.
      enableJsonResponse: true,
      onsessionclosed: (closedId) => {
        sessions.delete(closedId);
      },
    });
    const server = createMcpServer(rootDir, {
      actor,
      instructions: sessionInstructions(actor, registered, tokenLocked),
      // Downgraded (unregistered) sessions must stay read-only even in a
      // legacy allow-all workspace — the transport's promise must not depend
      // on the workspace's policy mode.
      ...(registered ? {} : { forceRolePolicy: true }),
    });
    return { session: { transport, server, actor }, sessionId };
  }

  const httpServer: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void handleRequest(req, res).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          jsonRpcError(res, 500, -32603, `Internal error: ${message}`);
        } else {
          res.end();
        }
      });
    },
  );

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Auth gate comes before anything else: every request re-authenticates,
    // which is what makes token revocation take effect on the very next
    // request (no session tearing needed).
    const identity = authenticateRequest(req, token, registryCtx, loopback);
    if (identity === null) {
      jsonRpcError(res, 401, -32001, 'Unauthorized: missing or invalid bearer token');
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== endpoint) {
      jsonRpcError(res, 404, -32001, `Not found: expected endpoint ${endpoint}`);
      return;
    }

    const sessionHeader = firstHeaderValue(req.headers, 'mcp-session-id');

    if (req.method === 'POST') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        jsonRpcError(res, 400, -32700, 'Parse error: invalid JSON body');
        return;
      }

      // New connection: an initialize request without a session id mints a
      // session and binds the connection's actor for its whole lifetime.
      if (isInitializeMessage(body) && sessionHeader === undefined) {
        try {
          const { session, sessionId } = createSession(req, identity);
          await session.server.connect(session.transport);
          sessions.set(sessionId, session);
          await session.transport.handleRequest(req, res, body);
        } catch (error) {
          // A rejected actor header (unknown role, malformed id) is the
          // client's mistake — surface it as a 400, not an internal error.
          if (error instanceof MesaError) {
            jsonRpcError(res, 400, -32602, error.message);
            return;
          }
          throw error;
        }
        return;
      }

      if (sessionHeader === undefined) {
        jsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }
      const session = sessions.get(sessionHeader);
      if (!session) {
        jsonRpcError(res, 404, -32001, `Not found: unknown session ${sessionHeader}`);
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'DELETE') {
      if (sessionHeader === undefined) {
        jsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }
      const session = sessions.get(sessionHeader);
      if (!session) {
        jsonRpcError(res, 404, -32001, `Not found: unknown session ${sessionHeader}`);
        return;
      }
      // The transport's DELETE handler invokes onsessionclosed → cleanup.
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'GET') {
      // Optional standalone SSE stream (spec-compliant). Only for known
      // sessions; we run in JSON response mode so there is nothing to push,
      // but the endpoint still answers per the transport contract.
      if (sessionHeader === undefined) {
        jsonRpcError(res, 405, -32000, 'Method not allowed: SSE stream requires a session');
        return;
      }
      const session = sessions.get(sessionHeader);
      if (!session) {
        jsonRpcError(res, 404, -32001, `Not found: unknown session ${sessionHeader}`);
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { allow: 'GET, POST, DELETE' });
    res.end();
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    httpServer.once('error', rejectPromise);
    httpServer.listen(options.port ?? 8765, host, () => resolvePromise());
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 8765;

  return {
    host,
    port,
    url: `http://${host}:${port}${endpoint}`,
    get sessionCount() {
      return sessions.size;
    },
    actorForSession(sessionId: string) {
      return sessions.get(sessionId)?.actor;
    },
    async close() {
      for (const session of sessions.values()) {
        await session.transport.close();
      }
      sessions.clear();
      const closed = new Promise<void>((resolvePromise, rejectPromise) => {
        httpServer.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
      // Keep-alive sockets (fetch/undici, node http agent) would otherwise
      // hold the listener open indefinitely.
      httpServer.closeAllConnections();
      await closed;
    },
  };
}
