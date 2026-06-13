# AgentMesa Local AI Action Plan

This document gives local AI agents a concrete action direction.

The human product owner has clarified that AgentMesa targets the complete product, not a reduced version. All local AI changes should follow this direction.

## Role Split

### External Reviewer

The external reviewer provides:

- Architecture direction.
- Review decisions.
- Refactor priorities.
- Acceptance criteria.
- Stop rules.

### Local AI Agent

The local AI agent executes:

- Code changes.
- Document updates.
- Refactors.
- Tests.
- Build fixes.
- Local validation.

## Current Decision

Do not continue feature work first.

The next work is architecture hardening.

## Priority 1: Domain Model Documents

Create these documents first:

```txt
docs/DOMAIN_MODEL.md
docs/RUNTIME_CONTEXT.md
docs/TRANSPORTS.md
docs/EVENTS.md
docs/STORAGE.md
docs/POLICY_ENGINE.md
```

Each document should describe the complete product target, not only the current code.

## Priority 2: Protocol Refactor

Direction:

- Make protocol schemas the source of truth.
- Infer exported TypeScript types from schemas.
- Add complete domain objects for meetings, tasks, messages, artifacts, threads, decisions, transports, clients, repositories, workspaces, agent runs, and events.
- Add version and migration design.

Acceptance:

- Every durable object has a schema.
- Every durable object can be validated at runtime.
- Types and schemas cannot drift.

## Priority 3: Runtime Context

Status: `complete_for_core_services`

Current progress:

- Added the shared `MesaRuntimeContext` and injectable runtime dependencies.
- Migrated task create/read/list/status/assignment/delete operations.
- Migrated meeting, message, artifact, and agent registry service APIs to runtime context.
- Migrated CLI task/meeting/message/artifact/agent commands to user runtime context.
- Migrated MCP task/message/review/artifact/meeting/agent handlers to agent runtime context.
- Migrated Desk read paths for task/meeting/message/artifact/agent to system runtime context.
- Migrated Git/Shell/GitHub connector artifact writes through connector actor runtime contexts.
- Added default file storage, in-memory event store, allow-all policy, and console logger.
- Added stable in-memory runtime events for task deletion, meeting status changes, meeting membership changes, and agent registration.
- Preserved EventStore as a non-persistent in-memory stub; Event-backed State has not started.

Deferred out of Priority 3:

- Lock manager remains `paths`-based and moves to Storage Hardening with atomic and lock-aware writes.
- Runner and Orchestrator full runtime lifecycles remain out of scope for this stage.
- Runtime events are not persistent yet and cannot rebuild state.

Direction:

- Add one shared runtime context for Core services.
- All state-changing services should receive runtime context, not only paths.
- Runtime context should include workspace paths, config, actor, storage, event store, policy layer, and logger.

Acceptance:

- Task, meeting, message, artifact, and agent services all use runtime context.
- CLI creates a user runtime context.
- Future MCP tools can create an agent runtime context.

## Priority 4: Event-Backed State

Status: `minimal_projection_rebuild_done` (+ engineering closure)

- FileEventStore: append-only JSONL at `.agentmesa/events/events.jsonl`, validates against MesaEventSchema.
- Default `MesaRuntimeContext` eventStore is `FileEventStore`; events survive process exit.
- All core services append runtime events through the file store.
- Projection rebuild: `rebuildTaskProjections` / `rebuildMeetingProjections` / `rebuildAgentProjections` / `rebuildAllProjections` replay events and write to `.agentmesa/projections/`.
- `rebuildAllProjections(ctx, { clean: true })` removes stale projections before rebuild.
- Event replay is deterministic (sort: sequence → timestamp → id).
- Projection read services: `getTaskProjection` / `getMeetingProjection` / `getAgentProjection` / `listTaskProjections` / `listMeetingProjections` / `listAgentProjections`.
- `archiveTask` emits `task_archived` (soft-archive, file preserved); replay produces tombstone same as `task_deleted`.
- Meeting seed tasks/agents are preserved during rebuild (reads both `meeting.tasks`/`meeting.agents` and future alias fields).
- Deleted/archived tasks produce tombstone projections (not removed).
- Projections validate required fields before writing (id, type, _meta, taskIds/agentIds for meetings).
- Existing services still read from `.agentmesa/tasks/` etc. — projections not yet the authoritative read path.
- Incremental rebuild and staleness auto-detection are not yet implemented.

Direction:

- Add an event model.
- Add event storage.
- Record an event for every important state change.
- Treat current task and meeting JSON as projections rather than the only source of truth.

Acceptance:

- A task can be reconstructed from events.
- A meeting timeline can be reconstructed.
- Broken projections can be detected and rebuilt.

## Priority 5: Storage Hardening

Status: `durable_and_diagnosed`

- All durable writes go through `FileStorageAdapter` (atomic temp+fsync+rename).
- `FileEventStore.append` fsyncs after each append; `appendRuntimeEvent` locks the event log to prevent interleaved sequence allocation across concurrent clients.
- `withLock` (atomic wx create) + UUID `token` per lock enables precise lock-holder identification.
- `archiveTask` preserves the task file (archived=true) instead of hard-deleting.
- `validateEventLog` / `checkProjectionConsistency` / `findOrphanedLocks` wired into `mesa doctor` for local diagnostics.
- Lock token, fsync behavior, event-durability, and diagnostic findings are all tested.

Direction:

- Route durable file writes through a storage adapter.
- Make writes safe for multiple clients.
- Add local diagnostics for invalid records.
- Avoid permanent removal of domain records during normal product flows.

Acceptance:

- Services do not write durable files directly.
- Diagnostics can find invalid local state.
- Normal workflows preserve history.

## Priority 6: Transport Layer

Status: `transport_abstraction_done`

- `TransportCapabilitiesSchema` in protocol: structured capabilities (canCreateTasks, canReadTasks, etc.) replacing loose `string[]`.
- `MesaTransportSchema` updated to use structured capabilities.
- `MesaTransport` interface in core types with `{ name, type, capabilities, version, isAvailable() }`.
- `FileTransport`: always-available reference implementation with full read/write capabilities.
- Transport registry in `MesaRuntimeContext.transports`; custom transports injectable via options.
- `findTransportsByType` / `getAvailableTransports` query helpers.
- MCP server treated as one transport implementation, not the center.
- Core runtime has zero dependency on any specific client transport.
- HTTP, WebSocket, GitHub, CI transports remain design intent.

Direction:

- Define Mesa Transport as a product-level abstraction.
- Treat File Protocol and MCP as transport implementations.
- Prepare future HTTP, WebSocket, GitHub, and CI transports.

Acceptance:

- MCP is not treated as the center of AgentMesa.
- Core runtime has no dependency on a specific client transport.
- File-based participation remains possible.

## Priority 7: Policy Layer

Status: `role_based_engine_done`

- `RoleBasedPolicyEngine` in core: maps action keys (e.g. `task.create`) → capabilities (e.g. `write_task`) with per-role capability sets. Owner bypass built in. Constructor accepts overrides.
- `AllowAllMesaPolicyEngine` kept as development default; `RoleBasedPolicyEngine` available via `createRuntimeContext({ policy: ... })`.
- Policy package: `PermissionChecker`, `FileAccessChecker`, `CommandPolicyChecker`, `SecretProtection`, `AuditLog` all shipped.
- `POLICY_ENGINE.md` updated with implementation status table.

Deferred:
- Capability gating (canEditFiles, canRunShell, etc.) is not checked by core services.
- Context-aware policy (taskState, meetingPhase, timeWindow) remains design intent.
- `RoleBasedPolicyEngine` is not the default — `AllowAllMesaPolicyEngine` is.

Direction:

- Add a policy model before agent automation expands.
- Actions and resources should be explicit.
- Agent roles and capabilities should be checked before state-changing operations.

Acceptance:

- Services have a single place to check permissions.
- Different agents can have different capabilities.
- Future runners and transports can reuse the same policy layer.

## Priority 8: CLI Alignment

Direction:

- Make CLI use the same runtime context as future transports.
- Add JSON output for local AI consumption.
- Add inspection commands for events, timelines, transports, and diagnostics.

Acceptance:

- CLI is not a special case.
- CLI can be used by local AI safely and predictably.
- CLI validates workspace health.

## Do Not Start Yet

Do not start these larger features until the architecture hardening tasks are complete:

```txt
MCP server expansion
Runner automation
Claude plugin implementation
Codex plugin implementation
Orchestrator implementation
GitHub integration
CI integration
Mesa Desk implementation
```

## Expected Local AI Workflow

1. Read `docs/VISION.md`.
2. Read `docs/AI_REVIEW_NOTES.md`.
3. Read `docs/ARCHITECTURE_HARDENING.md`.
4. Read this action plan.
5. Create or update the domain architecture documents.
6. Implement Protocol schema-first refactor.
7. Implement Runtime Context.
8. Implement Event-backed state.
9. Update tests and CLI.
10. Report changes for review.
