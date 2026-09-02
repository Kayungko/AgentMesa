# AgentMesa Transports

AgentMesa is a universal cross-client meeting layer for AI coding agents.

Agents do not connect to AgentMesa through a single channel. They connect through whichever **transport** their client supports. MCP is one transport. The file protocol is one transport. HTTP, WebSocket, GitHub, and CI are equally valid transports.

This document defines the transport abstraction and every transport AgentMesa targets.

## MesaTransport Interface

Every transport implements the same contract:

```ts
interface MesaTransport {
  readonly name: string;
  readonly type: TransportKind;
  readonly capabilities: MesaTransportCapabilities;
  readonly version: string;
  isAvailable(): boolean;
  // v0.8 inbox/outbox (optional — only file-based transports implement this)
  writeInbound?(envelope: TransportEnvelope): void;
  writeOutbound?(envelope: TransportEnvelope): void;
  listInbound?(status?: TransportEnvelopeStatus): TransportEnvelope[];
  listOutbound?(status?: TransportEnvelopeStatus): TransportEnvelope[];
  markProcessed?(id: string, direction?: 'inbound' | 'outbound'): boolean;
  markFailed?(id: string, error: string, direction?: 'inbound' | 'outbound'): boolean;
}
```

`TransportCapabilities` declares what the transport supports:

```ts
interface TransportCapabilities {
  canCreateTasks: boolean;
  canReadTasks: boolean;
  canUpdateTaskStatus: boolean;
  canPostMessages: boolean;
  canAttachArtifacts: boolean;
  canCreateMeetings: boolean;
  canRegisterAgents: boolean;
  supportsPush: boolean;       // server can push events to client
  supportsBidirectional: boolean;
}
```

The runtime selects transports based on `isAvailable()` and `capabilities`. Multiple transports may be active simultaneously for the same workspace.

## Transport Envelope

v0.8 introduces a structured envelope for transport-level messages. Every message between transports carries a `TransportEnvelope`:

```ts
interface TransportEnvelope {
  id: string;
  protocolVersion: string;
  transport: string;           // transport name
  direction: 'inbound' | 'outbound';
  actor: string;
  meetingId?: string;
  taskId?: string;
  type: string;                // e.g. 'task_created'
  payload: Record<string, unknown>;
  createdAt: string;
  correlationId?: string;
  replyTo?: string;
  status: 'pending' | 'processed' | 'failed';
  error?: string;
}
```

The schema is defined in `packages/protocol/src/envelope.ts` using zod. All envelope writes are schema-validated. The inbox/outbox pattern uses atomic file writes through `FileStorageAdapter`.

## Transport Registry

v0.8 adds a transport registry for runtime transport management:

| Function | Purpose |
|---|---|
| `registerTransport(ctx, transport)` | Register a new transport (rejects duplicates) |
| `listTransports(ctx)` | Return all registered transports |
| `getTransport(ctx, name)` | Find a transport by name |
| `inspectTransport(ctx, name)` | Policy-gated inspection (`transport.inspect`) |

The registry is the recommended API for transport inspection. Direct access to `ctx.transports` remains available for low-level use.

## CLI Commands

v0.8 expands `mesa transports` with subcommands and policy enforcement:

```
mesa transports list              List available transports
mesa transports inspect <name>    Show transport details (transport.inspect policy-gated)
mesa transports inbox <name>      List inbound envelopes (transport.inspect policy-gated)
mesa transports outbox <name>     List outbound envelopes (transport.inspect policy-gated)
```

All subcommands support `--json` for structured output. Inbox/outbox support optional `--status pending|processed|failed` filtering. Invalid status values are rejected with a validation error (exit code 1).

Inbox and outbox inspection is policy-gated via `inspectTransport(ctx, name)`, which enforces `transport.inspect`. Only actors whose role grants `transport.inspect` (by default: owner, admin, system, reviewer) can inspect transport envelopes.

`doctor --json` preserves `category`, `path`, `resourceId`, `fixable`, and `recommendation` fields on all diagnostic findings. `recordSimple()` findings use `category: "general"`.

## File Protocol Transport

The lowest-friction entry. Any agent that can read and write files can participate.

**How it works:**
- Reads and writes JSON files under `.agentmesa/` in the project root.
- Tasks live in `.agentmesa/tasks/`, messages in `.agentmesa/messages/`, artifacts in `.agentmesa/artifacts/`, meetings in `.agentmesa/meetings/`.
- Inbox/outbox directories (`.agentmesa/inbox/`, `.agentmesa/outbox/`) store `TransportEnvelope` objects for async message passing between transports.
- No daemon, no network, no server process required.
- Concurrency is managed through file locks in `.agentmesa/locks/`.
- All writes use atomic temp+fsync+rename through `FileStorageAdapter`.
- Envelope writes are schema-validated before storage.

**Capabilities:** read/write tasks, messages, artifacts, meetings, and agent registrations. Full inbox/outbox support for envelope-based communication. No push support.

`writeInbound` rejects envelopes with direction `outbound`; `writeOutbound` rejects envelopes with direction `inbound`. `checkTransportEnvelopes` in diagnostics detects direction/mailbox mismatches (e.g., an outbound envelope in the inbox directory) and reports them as errors with clear repair recommendations.

**Availability:** always available when `.agentmesa/` exists — the agent only needs filesystem access.

This is the universal fallback transport and the reference implementation for the inbox/outbox pattern. Every agent client can use it.

## MCP Transport

The Mesa MCP server acts as a transport adapter. It wraps each Core service call as an MCP tool so MCP-capable clients (Claude Code, Codex, Cursor) can call them directly.

**How it works:**
- The server starts via `node @agentmesa/mcp-server serve --mcp`.
- It registers tools mapped to Core services: `mesa_create_task`, `mesa_list_tasks`, `mesa_read_task`, `mesa_update_status`, `mesa_post_message`, `mesa_request_review`, `mesa_submit_review`, `mesa_attach_artifact`, `mesa_list_artifacts`, `mesa_create_meeting`, `mesa_list_meetings`, `mesa_register_agent`, `mesa_list_agents`.
- Each tool uses `MesaWorkspacePaths` to resolve the `.agentmesa/` directory and delegates to the same Core functions used by the CLI and file transport.
- Each tool invocation includes an agent actor identity (`createdBy`, `from`, `updatedBy`).

**Capabilities:** full read/write. No push support (stdio is request-response).

**Availability:** when an MCP client (Claude Desktop, Codex CLI, Cursor) is configured with `agentmesa` in its MCP server list.

MCP is **one transport**, not the center. The tools it exposes are thin adapters over Core — the same Core any other transport can call.

## MCP Streamable HTTP (Release 1.3)

The MCP server's second wire binding, for GUI apps with custom-connector
support (ChatGPT dev mode, Claude Desktop, Cursor, Mana-class apps). It runs
the same tools as stdio — the transport layer is abstracted so tool handlers
stay transport-agnostic.

**How it works:**
- Start with `mesa-mcp --transport http [--host 127.0.0.1] [--port 8765] [--token <token>]` (or `AGENTMESA_MCP_TRANSPORT=http` plus the `AGENTMESA_HTTP_HOST` / `AGENTMESA_HTTP_PORT` / `AGENTMESA_HTTP_TOKEN` environment variables).
- Single endpoint (`/mcp` by default) speaking the MCP Streamable HTTP transport specification: `POST` for JSON-RPC requests/responses, `DELETE` to terminate a session, and an optional SSE `GET` stream for servers that push (this deployment answers tool calls with plain JSON responses).
- Sessions are stateful: the server assigns an `mcp-session-id` at `initialize` and routes every subsequent request to that session's transport + server pair.

**Per-connection actor binding.** Each session owns its own `McpServer`
instance whose actor is adjudicated at initialize time — never the shared
env-derived actor that stdio uses:

- `x-agentmesa-actor-id` — the actor id (e.g. `agent:codex`). Omitted: a
  connection-scoped fallback `agent:http-<sessionId prefix>`, unique per
  connection.
- `x-agentmesa-actor-roles` — **not trusted.** Roles are adjudicated
  server-side from the agent registry (2026-09-03 hardening): a registered
  id gets its registered roles; an unregistered id is downgraded to
  `read_only`. Garbage values in the header still fail loudly with a 400,
  but valid-looking values are ignored. The initialize response's
  `instructions` field tells the client which identity and roles it actually
  got, and how to bootstrap (self-register) if downgraded.

Migration for clients that previously relied on header-declared roles: have
the operator pre-register the client's actor id
(`mesa agent add <id> <name> <roles...>`), or connect once and call
`mesa_register_agent` to self-register under non-privileged roles, then
reconnect. There is no header-trust escape hatch by design.

Because room tools normalize the actor id to a member ref, a remote agent
connecting as `agent:remote-bot` can only speak as `remote-bot` — the M1
anti-spoofing rules hold unchanged over HTTP.

**Per-member tokens (2026-09-03).** For strong identity guarantees, grant an
agent its own credential with `mesa token grant <agentId>` (owner/admin
only). The agent then connects with `Authorization: Bearer <member-token>`:
its actor id is pinned to the token's agent — no actor-id header needed, and
a contradicting one is rejected with 400. Roles still come from the
registry. Rotation (`mesa token rotate`) kills the old token immediately;
revocation takes effect on the agent's next request. See SECURITY.md
"Per-Member Tokens" for the storage model and residual limits.

**Remote member registration.** `mesa_register_remote_member` registers a
remote agent in the agent registry (`client: "remote"`, optional
`metadata.endpoint`) and optionally invites it into a room under the reserved
`remote` workspace id — member triple `("remote", "agent", <agentId>)`.

**Local-first isolation & authentication matrix:**
- The listener binds `127.0.0.1` by default.
- Binding a non-loopback host without ANY auth credential refuses to start —
  a shared token (`--token` / `AGENTMESA_HTTP_TOKEN`) or at least one active
  member token both satisfy the gate.

| Credential presented | Loopback, no shared token | Shared token configured | Non-loopback, member tokens only |
|---|---|---|---|
| *(none)* | allowed (anonymous, local-first default) | **401** | **401** |
| Shared token | allowed (`shared` identity) | allowed (`shared` identity) | — *(no shared token configured)* |
| Valid member token | allowed (`member` identity, id pinned) | allowed (`member` identity, id pinned) | allowed (`member` identity, id pinned) |
| Invalid / revoked / rotated-out token | **401** (tightened 2026-09-03; previously ignored) | **401** | **401** |

Every request re-authenticates — that is what makes revocation and rotation
take effect on the very next request, with no session-tearing API.

**Capabilities:** full read/write (same tools as stdio). Push support is
available through the optional SSE stream but not required by clients.

**Availability:** when the MCP server is started with `--transport http`.

## HTTP Transport (future)

A local REST API for agents that do not support MCP but can make HTTP requests.

**How it works:**
- Runs on a local port (e.g. `localhost:3456`).
- Exposes `GET/POST /api/tasks`, `GET /api/tasks/:id`, `GET/POST /api/messages`, `GET/POST /api/artifacts`, `GET/POST /api/meetings`.
- Auth via a local token stored in `.agentmesa/config.json`.

**Capabilities:** full read/write. No push support.

**Availability:** when the Desk server or a standalone HTTP adapter is running.

## WebSocket Transport (future)

Push events to connected clients in real time.

**How it works:**
- Clients connect to a local WebSocket endpoint.
- Subscribe to specific meetings or tasks to receive updates.
- Events include task status changes, new messages, artifact attachments, and meeting lifecycle events.

**Capabilities:** push-first. Write operations go through another transport (HTTP or MCP).

**Availability:** when the Mesa Desk server or a standalone event server is running.

## GitHub Transport (future)

Bridges GitHub PRs and issues into AgentMesa meetings.

**How it works:**
- PR comments are imported as AgentMesa messages.
- CI results attached to a PR are stored as check artifacts.
- PR status (open, review requested, changes requested, approved, merged) maps to task status transitions.
- A GitHub App or Action handles the synchronization.

**Capabilities:** read messages/comments, attach CI artifacts, sync PR status. Limited write — intended for inbound integration.

**Availability:** when the GitHub App is installed on the repository and a webhook secret is configured.

## CI Transport (future)

Bridges CI pipeline results into AgentMesa tasks.

**How it works:**
- Pipeline execution results are stored as check artifacts.
- Test output files become attached artifacts.
- Pipeline status (running, success, failure) maps to task status transitions.

**Capabilities:** attach artifacts, update task status. No message or task creation.

**Availability:** when a CI job is configured to call the Mesa HTTP endpoint or write artifacts to `.agentmesa/`.

## Implementation Status

| Component | Status |
|---|---|
| `TransportEnvelopeSchema` (protocol) | **Done.** Full zod schema: id, direction, status, payload, correlationId, replyTo, error. Types inferred from schema. |
| `generateEnvelopeId()` (protocol) | **Done.** Format: `env_xxxxxxxx`. |
| `TransportCapabilitiesSchema` (protocol) | **Done.** Structured schema with `canCreateTasks`, `canReadTasks`, `canUpdateTaskStatus`, `canPostMessages`, `canAttachArtifacts`, `canCreateMeetings`, `canRegisterAgents`, `supportsPush`, `supportsBidirectional`. |
| `MesaTransportSchema` (protocol) | **Done.** Updated to use `TransportCapabilitiesSchema` instead of loose `string[]`. |
| `MesaTransport` interface (core) | **Done.** `{ name, type, capabilities, version, isAvailable(), writeInbound?, writeOutbound?, listInbound?, listOutbound?, markProcessed?, markFailed? }`. |
| `FileTransport` (core) | **Done.** Always-available transport with full read/write capabilities and inbox/outbox. |
| `FileTransport` inbox/outbox (core) | **Done.** `writeInbound/writeOutbound` with schema validate + atomic write. `listInbound/listOutbound` with status filter. `markProcessed/markFailed` with optional `direction` parameter (default `'inbound'`, supports `'outbound'`). Corrupted files skipped with silent resilience. |
| `createDefaultTransports` (core) | **Done.** Bootstraps `[FileTransport]` with paths and storage. Custom transports injectable via `CreateRuntimeContextOptions.transports`. |
| `findTransportsByType` / `getAvailableTransports` (core) | **Done.** Registry query helpers. |
| Transport Registry (core) | **Done.** `registerTransport/listTransports/getTransport/inspectTransport` with `transport.inspect` policy enforcement. |
| `MCPTransport` skeleton (core) | **Done.** Declares capabilities, `isAvailable()` returns false. Future integration path documented. |
| MCP server | **Partial.** MCP server exists and maps tools to Core services, but uses `process.cwd()` directly rather than the `MesaTransport` interface. Full transport-registry integration is design intent. |
| MCP streamable HTTP (mcp-server) | **Done.** Transport selection (`--transport stdio\|http`), per-session `StreamableHTTPServerTransport` with per-connection actor binding from initialize-time headers, remote member registration (`mesa_register_remote_member`, reserved `remote` workspace id), loopback-by-default binding with token required for non-loopback hosts and `Authorization: Bearer` enforcement on every request. |
| CLI transport subcommands | **Done.** `mesa transports list/inspect/inbox/outbox` with `--json` and `--status` filter. Inbox/outbox are policy-gated via `transport.inspect`. `--status` validates against allowed values and rejects invalid input. |
| Transport envelope diagnostics | **Done.** `checkTransportEnvelopes(ctx)` validates all inbox/outbox envelope JSON files against `TransportEnvelopeSchema`. Detects corrupted files, schema-invalid envelopes, and direction/mailbox mismatches (e.g., outbound envelope in inbox). All findings reported with category, path, resourceId, and recommendation. Wired into `mesa doctor` and `mesa doctor --json`. |
| Transport direction consistency (hardening) | **Done.** `writeInbound` rejects outbound-direction envelopes. `writeOutbound` rejects inbound-direction envelopes. `checkTransportEnvelopes` detects direction/mailbox mismatches. `markProcessed`/`markFailed` accept optional `direction` parameter for outbound envelopes. |
| Doctor `--json` category preservation (hardening) | **Done.** `record()` includes `category`, `path`, `resourceId`, `fixable`, and `recommendation` from `DiagnosticFinding`. `recordSimple()` uses `category: "general"`. |
| HTTP transport | **Design intent.** |
| WebSocket transport | **Design intent.** |
| GitHub transport | **Design intent.** |
| CI transport | **Design intent.** |

## Transport Selection

The runtime evaluates available transports at startup:

1. **File transport** is always enabled if `.agentmesa/` exists.
2. **MCP transport** is enabled if the MCP server is started with `--mcp` (stdio) or `--transport http` (streamable HTTP).
3. **HTTP/WebSocket transport** is enabled when the Desk server or a standalone adapter is running.
4. **GitHub transport** is enabled when a GitHub App webhook secret is present.
5. **CI transport** is enabled when a CI provider is configured.

Multiple transports can be active simultaneously. The runtime routes operations through the best available transport for each agent based on its declared capabilities and the transport's own capabilities.

Agents declare which transports they support in their capability declaration:

```ts
supportedTransports: ['file', 'mcp']  // an agent that supports both
```

## Security

Each transport enforces its own security boundary:

| Transport | Security Model |
|-----------|---------------|
| File | OS file permissions on `.agentmesa/`. An agent must have read/write access to the project directory. |
| MCP | Local-only by default. The MCP server runs on stdio and has the same filesystem access as the calling process. |
| HTTP | Auth required. A local token in `.agentmesa/config.json` must be included in the `Authorization` header. |
| MCP streamable HTTP | Loopback (`127.0.0.1`) by default. Non-loopback binds refuse to start without an auth credential (shared token or active member token); every request must then authenticate. Shared token: header actor id + registry-adjudicated roles (unregistered ids are read-only). Member token (`mesa token grant`): identity pinned to the token's agent, roles from the registry. |
| WebSocket | Auth required. Same local token mechanism as HTTP. |
| GitHub | Webhook signature verification. The GitHub App validates HMAC signatures against the configured secret. |
| CI | Token-based. The CI provider receives a one-time write token scoped to the specific pipeline run. |

Transport-level permission checks ensure that even if a transport is available, the acting agent must still pass policy evaluation before any mutation is applied.
