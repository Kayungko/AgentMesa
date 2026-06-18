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

Status: `read_path_hardened` (+ strict projection mode, freshness enforcement on both GET and LIST, warn+fallback hybrid)

- FileEventStore: append-only JSONL at `.agentmesa/events/events.jsonl`, validates against MesaEventSchema.
- Default `MesaRuntimeContext` eventStore is `FileEventStore`; events survive process exit.
- All core services append runtime events through the file store.
- Projection rebuild: `rebuildTaskProjections` / `rebuildMeetingProjections` / `rebuildAgentProjections` / `rebuildAllProjections` replay events and write to `.agentmesa/projections/`.
- `rebuildAllProjections(ctx, { clean: true })` removes stale projections before rebuild.
- Event replay is deterministic (sort: sequence → timestamp → id).
- Projection read services: `getTaskProjection` / `getMeetingProjection` / `getAgentProjection` / `listTaskProjections` / `listMeetingProjections` / `listAgentProjections`.
- Projection freshness: `isTaskProjectionFresh` / `isMeetingProjectionFresh` / `isAgentProjectionFresh` compare `_meta.lastSequence` against max event sequence.
- `archiveTask` emits `task_archived` (soft-archive, file preserved); replay produces tombstone same as `task_deleted`.
- Meeting seed tasks/agents are preserved during rebuild (reads both `meeting.tasks`/`meeting.agents` and future alias fields).
- Deleted/archived tasks produce tombstone projections (not removed).
- Projections validate required fields before writing (id, type, _meta, taskIds/agentIds for meetings).
- **Authoritative read model:** `read-model-service.ts` provides `get*ReadModel` / `list*ReadModels`. Config `readModel.mode` controls `hybrid` (default, projection + legacy fallback), `projection`-only, or `legacy`-only reads. Both GET and LIST enforce freshness: projection mode throws on any stale, hybrid mode warns and falls back to legacy.
- **CLI migration complete:** `mesa task/meeting/agent list/show` use read-model-service. `mesa agent show <id>` added. `mesa rebuild` command available.
- **Doctor alignment:** `mesa doctor` detects stale projections (freshness check) and reports fixable warnings.
- **Read-model mode hardening complete:** `projection` mode throws `MesaError` on missing/stale/corrupt projections in both GET and LIST (no fallback). `hybrid` mode warns and falls back to legacy on missing/stale/corrupt projections for both GET and LIST. `legacy` mode never reads projections. Error messages prompt "Run mesa rebuild".
- Incremental rebuild is not yet implemented.

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
- Lock release validates token (not just file existence) — `releaseLock` checks token before releasing; `releaseLockUnsafe` provides backward-compatible unsafe release.
- Lock acquisition supports configurable timeout + retry via `AcquireLockOptions { timeoutMs?, retryIntervalMs? }`.
- `DiagnosticFinding` enriched with optional `path`, `resourceId`, `fixable`, `recommendation` fields for programmatic consumption.
- `mesa timeline <id>` (no subcommand) auto-detects task vs meeting with `inferredType` in JSON output.

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

Status: `transport_hardening_done`

- `TransportEnvelopeSchema` in protocol: full zod schema (id, direction, status, payload, correlationId, replyTo, error). Types inferred from schema.
- `generateEnvelopeId()`: `env_xxxxxxxx` format.
- `FileTransport` inbox/outbox: `writeInbound/writeOutbound` with schema validate + atomic write. `listInbound/listOutbound` with status filter. `markProcessed/markFailed` with optional `direction` parameter (default `'inbound'`, supports `'outbound'`). Corrupted files skipped with silent resilience.
- Transport Registry: `registerTransport/listTransports/getTransport/inspectTransport` with `transport.inspect` policy enforcement.
- `MCPTransport` skeleton: declares capabilities, `isAvailable()` returns false. Future integration path documented.
- CLI transport subcommands: `mesa transports list/inspect/inbox/outbox` with `--json` and `--status` filter. Inbox and outbox inspection are policy-gated via `inspectTransport` (enforces `transport.inspect`). `--status` validates against allowed values and rejects invalid input.
- Transport envelope diagnostics: `checkTransportEnvelopes(ctx)` validates all inbox/outbox envelope JSON files against `TransportEnvelopeSchema`. Detects corrupted files, schema-invalid envelopes, and direction/mailbox mismatches (e.g., outbound envelope in inbox directory). All findings include category, path, resourceId, and recommendation. Wired into `mesa doctor` and `mesa doctor --json`.
- Inbox/outbox direction consistency: `writeInbound` rejects outbound-direction envelopes; `writeOutbound` rejects inbound-direction envelopes. `checkTransportEnvelopes` detects direction/mailbox mismatches. `markProcessed`/`markFailed` accept optional `direction` parameter for outbound envelopes.
- Doctor JSON output: `record()` preserves `category`, `path`, `resourceId`, `fixable`, and `recommendation` from `DiagnosticFinding`. `recordSimple()` uses `category: "general"`.
- Inbox/outbox directories (`.agentmesa/inbox/`, `.agentmesa/outbox/`) for async multi-transport message passing.
- Core runtime has zero dependency on any specific client transport.
- HTTP, WebSocket, GitHub, CI transports remain design intent.

Direction:

- Define Mesa Transport as a product-level abstraction with envelope protocol.
- Treat File Protocol and MCP as transport implementations.
- Prepare future HTTP, WebSocket, GitHub, and CI transports.

Acceptance:

- MCP is not treated as the center of AgentMesa.
- Core runtime has no dependency on a specific client transport.
- File-based participation remains possible.
- Transports can exchange messages through inbox/outbox envelopes.
- Inbox/outbox inspection is policy-gated.
- Envelope direction is enforced: inbound only in inbox, outbound only in outbox.
- Direction/mailbox mismatches are detected by diagnostics.
- Corrupted transport envelopes are detectable via doctor diagnostics.
- Doctor --json preserves category, path, and recommendation on all findings.

## Priority 7: Policy Layer

Status: `baseline_complete` — policy enforcement foundation is in place. This is not a full security model; it enforces coarse-grained role boundaries. `RoleBasedPolicyEngine` is available but NOT the default (local dev uses `AllowAllMesaPolicyEngine`). Capability gating (canEditFiles, canRunShell) and finer-grained ABAC checks remain deferred.

- `RoleBasedPolicyEngine` in core: maps 21 action keys → 14 capabilities with per-role capability sets. Owner bypass built in. Constructor accepts overrides.
- Production roles: `owner`, `admin`, `builder`, `reviewer`, `connector`, `ci`, `system`. Legacy roles preserved.
- Unknown actions are denied by default.
- `canWithContext(actor, action, resource, context?)` enforces reviewer status transition gate: pure reviewer may only transition to `approved` or `changes_requested`. Multi-role actors (reviewer+builder, reviewer+chair, reviewer+admin, reviewer+maintainer, reviewer+owner) bypass the gate via non-reviewer `change_status` capability. `updateTaskStatus` passes `targetStatus` via `assertPolicyWithContext()`.
- `mesa policy check` / `mesa policy inspect` default to `--mode role-based` (canonical `RoleBasedPolicyEngine`). `--mode current` uses workspace config. `--role` validated against known AgentRole values; `--roles a,b` supports multi-role. Both commands output `mode` in JSON. `policy inspect` covers all 14 VALID_ROLES (owner, admin, builder, reviewer, connector, ci, system, chair, planner, tester, documenter, maintainer, researcher, custom). Missing `action` in `policy check` with `--json` outputs structured error via `outputError`.
- Read path enforcement: `listEvents`/`getTaskEvents`/`getMeetingEvents` → `event.read`; `getTaskProjection`/`getMeetingProjection`/`getAgentProjection`/`listTaskProjections`/`listMeetingProjections`/`listAgentProjections` → `projection.read`; `rebuildTaskProjections`/`rebuildMeetingProjections`/`rebuildAgentProjections` → `projection.rebuild`; `runTransports` → `transport.inspect`. Internal helpers (`_get*`/`_list*`) and freshness helpers (`isTaskProjectionFresh`, etc.) are excluded from the `@agentmesa/core` public index — freshness checks are computed internally by `read-model-service` and `doctor`. Callers cannot bypass `projection.read` enforcement through public API.
- Policy enforcement tests cover: builder deny delete/archive, connector deny delete/create, ci deny delete/create, reviewer context-aware status gate (pure reviewer only approved/changes_requested; reviewer+builder/chair/admin/maintainer/owner bypass), system deny write tasks, owner/admin bypass, allow-all backward compat, event/projection/rebuild/transport enforcement, all 21 actions and 14 roles.
- CLI `resolveMode` throws on invalid `--mode`; error is caught and formatted via `outputError(err, json)` — structured JSON when `--json` is set, human-readable to stderr otherwise. Always sets `exitCode = 1`.
- `packages/policy` definitions (`PolicyAction`, `RoleCapability`, `PermissionChecker`) aligned with core policy engine (18 actions, 14 roles including `owner`).
- CLI uses the same `MesaRuntimeContext` as all other consumers.
- `AllowAllMesaPolicyEngine` kept as development default; `RoleBasedPolicyEngine` available via config `policy.mode: "role-based"` or injection.

Deferred:
- Capability gating (canEditFiles, canRunShell, etc.) is not checked by core services.
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

Status: `cli_aligned`

- `--json` flag supported across all commands (task, message, artifact, meeting, agent, init, doctor). When set, only JSON goes to stdout — safe for local AI consumption.
- `outputResult(data, json, humanRenderer)` helper ensures no mixed output when `--json` is active.
- New inspection commands:
  - `mesa events list [--meeting <id>] [--task <id>] [--type <type>] [--actor <id>]` — query event log
  - `mesa timeline <taskId|meetingId>` — show event timeline + reconstructed projection
  - `mesa transports` — list available transports and capabilities
- `mesa doctor` supports `--json` with structured findings output.
- `mesa init` supports `--json` with structured result.
- CLI uses the same `MesaRuntimeContext` as all other consumers — not a special case.

Direction:

- Make CLI use the same runtime context as future transports.
- Add JSON output for local AI consumption.
- Add inspection commands for events, timelines, transports, and diagnostics.

Acceptance:

- CLI is not a special case.
- CLI can be used by local AI safely and predictably.
- CLI validates workspace health.

## Priority 9: Agent Run Lifecycle + Handoff Loop (RUN-001)

Status: `complete`

Completed:
- Agent run domain model (run id, task id, meeting id, agent id, action, status, input/output, timestamps) integrated into protocol schema.
- Agent run events: `agent_run_created`, `agent_run_status_changed`, `agent_run_completed`, `agent_run_failed` added to event vocabulary.
- Agent run service: `createAgentRun`, `updateAgentRunStatus`, `getAgentRun`, `listAgentRuns` with policy enforcement via `manage_runs` capability.
- Runs directory (`.agentmesa/runs/`) added to workspace paths.
- Policy actions: `run.create`, `run.updateStatus`, `run.read` mapped to `manage_runs` capability.
- FileTransport handoff loop: `writeReviewRequest` (outbox), `writeReviewResult` (inbox), `listOutboundHandoffs`, `listInboundHandoffs`.
- CLI: `mesa runs create|list|show|complete` with `--json` support.
- Tests: AgentRun CRUD, event append, policy denied, FileTransport review_request/review_result, corrupted envelope resilience.

Deferred:
- Runner integration (agent execution engines remain a separate concern).
- Orchestrator integration.
- Claude/Codex plugin-specific run hooks.

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

## Next Milestones (Post-Hardening Sequence)

Architecture hardening (Priority 1–9) is complete. The "Do Not Start Yet" list
is now unblocked. Recommended order below, grouped by dependency and value.
These are large modules, not single-priority tasks; items within a stage can
partly parallelize.

### Stage A — Activate the loop (highest value, fewest dependencies)
1. **Runner automation** — `done`. `executeRun(ctx, runId, opts)` (in
   `packages/runner`) drives a `pending` run `pending → running →
   completed | failed`, resolving a backend via `resolveRunnerType` (explicit
   `run.runnerType` wins, else `action` maps to a default `RunnerType`), invoking
   it through the stable `createRunner` factory, persisting successful non-dry
   output as an `agent_run_log` artifact, and reusing `updateAgentRunStatus`
   (already gated by `manage_runs` — no new policy action). Surfaced as
   `mesa runs exec <id> [--dry-run]` plus the programmatic `executeRun` API the
   Orchestrator will call. `createAgentRun` now persists `runnerType`.
   **Deferred:** real Claude/Codex CLI subprocess spawn (plugin milestone); the
   Shell backend executes for real, Claude/Codex echo the prompt as output.
2. **Orchestrator** — `in_progress`. `WorkflowEngine.executeStep` is now real:
   it consumes a `WorkflowDefinition` + `MesaRuntimeContext` and dispatches each
   step by type — `update_status` (idempotent + tolerant of invalid task-status
   transitions), `run_agent` (creates a run and drives it via `executeRun`),
   `check` (evaluates the condition; increments `reviewCycles` on the fail
   branch), and `human_approval` (parks the workflow at `waiting_approval`). An
   `advanceWorkflow` driver auto-runs steps to a terminal/blocked state (bounded
   by `maxSteps`), `approve`/`reject` resume from approval, and a definition
   registry recovers closures after a reload. Surfaced as
   `mesa workflow start|status|approve|run`. The review verdict is a
   **deterministic loop + count guard** (`approved` flips only externally; 3
   cycles route to human approval). **Deferred:** parsing real review verdicts
   from runner output (plugin milestone). Note: because `update_status` is
   tolerant, workflow steps that request an invalid task-status transition (e.g.
   `ready_for_review → done` in `review-fix-loop`) are skipped without failing —
   the workflow completes even though the task does not reach `done`.

### Stage B — Connect real AI clients
3. **MCP server expansion** — access layer exposing core services over MCP so
   external AI clients can join. The `mcp-server` package already exists; this
   widens its surface. Can start in parallel with Stage A.
4. **Claude plugin** — Claude-specific run hooks / adapter (deferred in RUN-001).
5. **Codex plugin** — Codex-specific run hooks / adapter.

### Stage C — External integrations
6. **GitHub integration** — connector for PRs/issues; handoffs can target
   GitHub. Builds on the hardened transport layer.
7. **CI integration** — wire `MesaCheckResult` to CI pipelines (check schema
   already exists).

### Stage D — Visualization
8. **Mesa Desk** — UI dashboard for meetings/tasks/runs/handoffs. Usually last,
   but a read-only view could land earlier as a debugging aid.

Rationale: power the existing foundation first (Runner + Orchestrator make the
handoff loop run on its own), then onboard real AI participants (MCP + plugins),
then integrate outward (GitHub/CI), then build the UI.
