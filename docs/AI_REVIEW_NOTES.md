# AgentMesa Full Product Review Notes

This document records the architecture review for local AI agents working on AgentMesa.

## Non-negotiable Product Standard

All review comments, development plans, and refactor plans must target the complete AgentMesa product.

Do not optimize for a small proof-of-concept. Do not design only for Claude Code and Codex. Claude Code and Codex are the first proving pair, but the product target is broader:

> AgentMesa is a universal cross-client meeting layer for AI coding agents.

The system must eventually support Claude Code, Codex, Cursor, Gemini CLI, GitHub agents, CI agents, and other capable AI agents through a shared protocol and runtime.

## Current Review Status

Status: `changes_requested`

The current direction is correct, but the foundation must be hardened before continuing into MCP, Runner, Orchestrator, or plugin-specific work.

The repository already has the right high-level goal:

- Cross-client agent meetings.
- Structured tasks, messages, artifacts, and state.
- Local-first runtime.
- Plugin-first integration.
- Permission-aware execution.

However, the implementation must now shift from feature accumulation to final architecture hardening.

## Major Review Findings

### 1. MCP must not be treated as the architecture center

MCP is one transport layer, not the core system.

Correct long-term model:

```txt
Agent Clients
  -> Connectors
  -> Transport Layer
  -> Mesa Runtime
  -> Mesa Protocol
```

Required transport types:

- File protocol.
- MCP.
- HTTP or local API.
- WebSocket or event stream.
- GitHub App / PR transport.
- CI transport.

Action: introduce `MesaTransport` as an abstraction before implementing all MCP behavior.

### 2. Protocol should be schema-first

The current pattern has manually written TypeScript interfaces plus manually written Zod schemas. This will drift over time.

Required long-term rule:

```txt
Zod schema is the source of truth.
TypeScript types are inferred from schemas.
```

Action: refactor `packages/protocol` so schemas define the model and exported types use `z.infer`.

### 3. Protocol versioning must support migration

A literal current protocol version blocks future data migration.

Required model:

```txt
currentProtocolVersion
supportedProtocolVersions
migrateMesaObject(input)
```

Action: design migration before storing real user data.

### 4. Every mutation must include actor, policy, and event context

Current services can mutate state with only paths and input. This is not enough for a multi-agent system.

Required model:

```ts
createTask(ctx, input)
updateTaskStatus(ctx, taskId, status)
attachArtifact(ctx, input)
appendMessage(ctx, input)
```

`ctx` must include:

- Actor identity.
- Workspace paths.
- Runtime config.
- Policy engine.
- Storage adapter.
- Event store.
- Logger.

Action: introduce `MesaRuntimeContext` and migrate all service functions to use it.

### 5. Task IDs must not use in-memory counters

In-memory counters reset on every CLI or MCP process restart and can cause overwrites.

Required ID strategy:

```txt
task_<ulid>
meeting_<ulid>
msg_<ulid>
artifact_<ulid>
event_<ulid>
run_<ulid>
decision_<ulid>
thread_<ulid>
```

Action: introduce a shared ID generator in protocol or core.

### 6. State must be event-sourced or event-backed

Directly rewriting task JSON is not enough for a complete product. AgentMesa must preserve a complete audit trail.

Required model:

```txt
.agentmesa/events/*.jsonl       append-only source of truth
.agentmesa/projections/*        generated readable current state
.agentmesa/artifacts/*          durable outputs
.agentmesa/indexes/state.sqlite optional query index
```

Action: create an EventStore and treat task JSON as projection/cache.

### 7. Writes must be atomic and lock-aware

Direct JSON writes are unsafe under multiple agents or tools.

Required behavior:

- Write temp file.
- Flush where practical.
- Rename into place.
- Use locks for all mutations.
- Never allow simultaneous writes to the same logical resource.

Action: refactor storage and services around atomic write plus lock manager.

### 8. Messages need meeting and thread semantics

AgentMesa is a meeting layer, so messages cannot be only task-scoped.

Required additions:

- `meetingId` should be required on MesaMessage.
- `taskId` should be optional.
- `threadId` should be supported.
- `replyToMessageId` should be supported.
- Discussion resolution state should be modeled.

Action: add `MesaThread` and thread-aware messages.

### 9. Decision records must become first-class entities

A decision should not only be an artifact kind.

Required model:

```ts
MesaDecision {
  id
  meetingId
  taskId?
  decidedBy
  options
  selectedOption
  rationale
  createdAt
}
```

Action: add Decision to protocol and core services.

### 10. Capabilities need more detail than permission level

Roles and permission levels are not enough to represent real agent abilities.

Required model:

```ts
capabilities: {
  supportedTransports
  supportedArtifactKinds
  canReviewCode
  canEditFiles
  canRunShell
  canUseMcp
  canOpenPullRequest
  canReadPullRequest
  maxContextTokens?
}
```

Action: expand `MesaAgentCapability` into a real capability declaration.

## Current Development Rule

Before adding more user-facing features, the next work should harden these foundations:

1. Domain model.
2. Runtime context.
3. Event model.
4. Transport abstraction.
5. Policy enforcement.
6. Atomic and lock-aware storage.

Do not continue directly into Claude plugin, Codex plugin, Runner, or Orchestrator until these boundaries exist.
