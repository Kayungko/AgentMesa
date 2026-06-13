# AgentMesa Transports

AgentMesa is a universal cross-client meeting layer for AI coding agents.

Agents do not connect to AgentMesa through a single channel. They connect through whichever **transport** their client supports. MCP is one transport. The file protocol is one transport. HTTP, WebSocket, GitHub, and CI are equally valid transports.

This document defines the transport abstraction and every transport AgentMesa targets.

## MesaTransport Interface

Every transport implements the same contract:

```ts
interface MesaTransport {
  name: string;
  type: 'file' | 'mcp' | 'http' | 'websocket' | 'github' | 'ci';
  capabilities: TransportCapabilities;
  version: string;           // protocol version this transport speaks
  connect(): Promise<void>;  // connect to the meeting layer
  disconnect(): Promise<void>;
  isAvailable(): boolean;    // whether this transport works in the current environment
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

## File Protocol Transport

The lowest-friction entry. Any agent that can read and write files can participate.

**How it works:**
- Reads and writes JSON files under `.agentmesa/` in the project root.
- Tasks live in `.agentmesa/tasks/`, messages in `.agentmesa/messages/`, artifacts in `.agentmesa/artifacts/`, meetings in `.agentmesa/meetings/`.
- No daemon, no network, no server process required.
- Concurrency is managed through file locks in `.agentmesa/locks/`.

**Capabilities:** read/write tasks, messages, artifacts, meetings, and agent registrations. No push support.

**Availability:** always available when `.agentmesa/` exists — the agent only needs filesystem access.

This is the universal fallback transport. Every agent client can use it.

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
| `TransportCapabilitiesSchema` (protocol) | **Done.** Structured schema with `canCreateTasks`, `canReadTasks`, `canUpdateTaskStatus`, `canPostMessages`, `canAttachArtifacts`, `canCreateMeetings`, `canRegisterAgents`, `supportsPush`, `supportsBidirectional`. |
| `MesaTransportSchema` (protocol) | **Done.** Updated to use `TransportCapabilitiesSchema` instead of loose `string[]`. |
| `MesaTransport` interface (core) | **Done.** `{ name, type, capabilities, version, isAvailable() }` in `MesaRuntimeContext.transports`. |
| `FileTransport` (core) | **Done.** Always-available transport with full read/write capabilities. |
| `createDefaultTransports` (core) | **Done.** Bootstraps `[FileTransport]`. Custom transports injectable via `CreateRuntimeContextOptions.transports`. |
| `findTransportsByType` / `getAvailableTransports` (core) | **Done.** Registry query helpers. |
| MCP transport | **Done** (mcp-server). `StdioServerTransport` maps MCP tools to Core services. Treated as one transport implementation, not the center. |
| HTTP transport | **Design intent.** |
| WebSocket transport | **Design intent.** |
| GitHub transport | **Design intent.** |
| CI transport | **Design intent.** |

## Transport Selection

The runtime evaluates available transports at startup:

1. **File transport** is always enabled if `.agentmesa/` exists.
2. **MCP transport** is enabled if the MCP server is started with `--mcp`.
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
| WebSocket | Auth required. Same local token mechanism as HTTP. |
| GitHub | Webhook signature verification. The GitHub App validates HMAC signatures against the configured secret. |
| CI | Token-based. The CI provider receives a one-time write token scoped to the specific pipeline run. |

Transport-level permission checks ensure that even if a transport is available, the acting agent must still pass policy evaluation before any mutation is applied.
