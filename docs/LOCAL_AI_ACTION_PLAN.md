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

Status: `role_based_default_for_new_workspaces` — `RoleBasedPolicyEngine` is now
the default for any newly initialized workspace (`mesa init`, or the first
`createRuntimeContext` call against a directory with no `.agentmesa/config.json`
yet). This is not a full security model; it enforces coarse-grained role
boundaries. Capability gating (canEditFiles, canRunShell) and finer-grained
ABAC checks remain deferred.

- `RoleBasedPolicyEngine` in core: maps 21 action keys → 14 capabilities with per-role capability sets. Owner bypass built in. Constructor accepts overrides.
- Production roles: `owner`, `admin`, `builder`, `reviewer`, `connector`, `ci`, `system`, `read_only`. Legacy roles preserved.
- Unknown actions are denied by default.
- **Default flip, `done`:** `createRuntimeContext`'s `loadOrCreateConfig` now
  writes `policy: { mode: 'role-based' }` into the config it creates for a
  brand-new workspace (`packages/core/src/runtime/create-runtime-context.ts`).
  Pre-existing workspaces are untouched — a `.agentmesa/config.json` already on
  disk without a `policy` field keeps resolving to `AllowAllMesaPolicyEngine`,
  exactly as before; only workspaces created after this change opt in. Flipping
  the default surfaced three real gaps that had to be fixed first, all in
  `packages/core/src/runtime/policy.ts`'s `ROLE_CAPABILITIES` table or the
  actor roles that reach it:
  - Mesa Desk's actor used `roles: ['read_only']` (`packages/desk/src/server.ts`),
    but `'read_only'` (a valid `PermissionLevel` in `@agentmesa/protocol`, just
    never added to the capability table) had zero mapped capabilities — every
    policy-checked call would have been denied. Added a real `read_only` role:
    `read_task`, `read_events`, `read_projections`, `manage_runs` (the last one
    is needed because `handoff.read` — Desk's only actually-guarded call,
    `/api/handoffs` — shares the same coarse-grained `manage_runs` capability as
    the write-side `run.create`/`handoff.write`/`check.create`; Desk's code never
    calls those, so the extra grant is unused in practice, not a live risk).
  - Every connector (`packages/connectors/{git,shell,github}/src/*.ts`) used
    `roles: ['custom']`, which only has `read_task` — not enough for
    `createArtifact` (`create_artifact`) or, for the GitHub CI connector,
    `createCheckResult` (`manage_runs`). Switched to the existing `connector`
    role (git/shell/github artifact + PR-link writers) or `ci` role
    (`connectors/github/src/ci.ts`, which needs both `create_artifact` and
    `manage_runs`) — no capability table changes needed, just picking the
    already-correct production role instead of the placeholder `custom`.
  - MCP Server's default actor role is `'builder'` (`AGENTMESA_MCP_ACTOR_ROLES`
    unset) and covers nearly every tool, but `mesa_create_meeting`
    (`manage_meetings`) and `mesa_register_agent` (`manage_agents`) would have
    been denied out of the box. Added both capabilities to `builder` (not the
    more sensitive `archive_task`/`delete_task`/`rebuild_projections`/
    `inspect_transports`) so an unconfigured MCP client keeps working.
  - Full workspace test suite (838 tests) passed with zero regressions after
    the flip — nearly every test builds a brand-new temp workspace via
    `mkdtempSync` + `initWorkspace`, so this was a real end-to-end check of the
    new default, not just the capability-table unit tests.
  - **Known follow-up, not done:** `mesa policy inspect`'s `VALID_ROLES` list
    (`packages/cli/src/commands/policy.ts`) predates this change and is typed
    as `AgentRole[]`, which doesn't include `read_only` (a `PermissionLevel`).
    Its `knownActions` list also predates Stage A/C and is already missing the
    `run.*`/`handoff.*`/`check.*` actions entirely. Both are pre-existing CLI
    inspection-tool staleness, not something this change introduced, but
    `read_only` (and the run/handoff/check actions) won't show up in
    `mesa policy inspect`'s matrix until that command's static lists are
    updated separately.
- `canWithContext(actor, action, resource, context?)` enforces reviewer status transition gate: pure reviewer may only transition to `approved` or `changes_requested`. Multi-role actors (reviewer+builder, reviewer+chair, reviewer+admin, reviewer+maintainer, reviewer+owner) bypass the gate via non-reviewer `change_status` capability. `updateTaskStatus` passes `targetStatus` via `assertPolicyWithContext()`.
- `mesa policy check` / `mesa policy inspect` default to `--mode role-based` (canonical `RoleBasedPolicyEngine`). `--mode current` uses workspace config. `--role` validated against known AgentRole values; `--roles a,b` supports multi-role. Both commands output `mode` in JSON. `policy inspect` covers all 14 VALID_ROLES (owner, admin, builder, reviewer, connector, ci, system, chair, planner, tester, documenter, maintainer, researcher, custom) — not yet `read_only`, see follow-up above. Missing `action` in `policy check` with `--json` outputs structured error via `outputError`.
- Read path enforcement: `listEvents`/`getTaskEvents`/`getMeetingEvents` → `event.read`; `getTaskProjection`/`getMeetingProjection`/`getAgentProjection`/`listTaskProjections`/`listMeetingProjections`/`listAgentProjections` → `projection.read`; `rebuildTaskProjections`/`rebuildMeetingProjections`/`rebuildAgentProjections` → `projection.rebuild`; `runTransports` → `transport.inspect`. Internal helpers (`_get*`/`_list*`) and freshness helpers (`isTaskProjectionFresh`, etc.) are excluded from the `@agentmesa/core` public index — freshness checks are computed internally by `read-model-service` and `doctor`. Callers cannot bypass `projection.read` enforcement through public API.
- Policy enforcement tests cover: builder deny delete/archive, connector deny delete/create, ci deny delete/create, reviewer context-aware status gate (pure reviewer only approved/changes_requested; reviewer+builder/chair/admin/maintainer/owner bypass), system deny write tasks, owner/admin bypass, allow-all backward compat, event/projection/rebuild/transport enforcement, read_only allow/deny, builder manage_agents/manage_meetings, all 21 actions and 15 roles.
- CLI `resolveMode` throws on invalid `--mode`; error is caught and formatted via `outputError(err, json)` — structured JSON when `--json` is set, human-readable to stderr otherwise. Always sets `exitCode = 1`.
- `packages/policy` definitions (`PolicyAction`, `RoleCapability`, `PermissionChecker`) aligned with core policy engine (18 actions, 14 roles including `owner`).
- CLI uses the same `MesaRuntimeContext` as all other consumers.
- New workspaces default to `RoleBasedPolicyEngine`; `AllowAllMesaPolicyEngine` remains available via config `policy.mode: "allow-all"` or injection, and is what pre-existing workspaces keep resolving to.

Deferred:
- Capability gating (canEditFiles, canRunShell, etc.) is not checked by core services.
- `mesa policy inspect`'s static role/action lists need a follow-up update (see above) to reflect `read_only` and the run/handoff/check actions.

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
   Real Claude/Codex CLI subprocess spawn now lands in Stage B (item 2.5 below).
2. **Orchestrator** — `done`. `WorkflowEngine.executeStep` is real: it consumes
   a `WorkflowDefinition` + `MesaRuntimeContext` and dispatches each step by
   type — `update_status` (idempotent + tolerant of invalid task-status
   transitions), `run_agent` (creates a run and drives it via `executeRun`),
   `check` (evaluates the condition; increments `reviewCycles` on the fail
   branch), and `human_approval` (parks the workflow at `waiting_approval`). An
   `advanceWorkflow` driver auto-runs steps to a terminal/blocked state (bounded
   by `maxSteps`), `approve`/`reject` resume from approval, and a definition
   registry recovers closures after a reload. Surfaced as
   `mesa workflow start|status|approve|run`.
   The review verdict is now the **real one**, not a fake loop: the review
   skills shipped with both plugins have the AI call the `mesa_submit_review`
   MCP tool directly during the reviewer's non-interactive CLI session, and
   `handleSubmitReview` (in `@agentmesa/mcp-server`) lands that verdict
   synchronously on the task's status (`approved` / `changes_requested`)
   before the CLI subprocess returns. `WorkflowEngine.runAgentStep` reads that
   status back right after a `runnerType: 'review'` step succeeds
   (`syncReviewVerdict`) and writes it into `WorkflowContext.approved` /
   `changesRequested`, so the `check` step reacts to what the reviewer
   actually decided instead of only reacting to a human `approve()` call. Both
   `review-fix-loop` and `full-task-workflow` gained an explicit
   `update_status -> reviewing` step between `ready_for_review` and the
   reviewer's `run_agent` step — without it, a first-pass `approved` verdict
   would throw inside the MCP tool call, because `ready_for_review -> approved`
   is not a valid transition in the protocol status graph (only
   `reviewing -> approved` is). The stub/CI fallback (no
   `AGENTMESA_CLAUDE_CMD`/`AGENTMESA_CODEX_CMD` configured) never calls the MCP
   tool, so the task status never leaves `reviewing` and the loop keeps its old
   3-cycle-then-human-approval fallback behavior — this real-verdict path is
   additive, not a breaking change to the no-backend-configured case.
   **Multi-cycle fix, `done`:** the limitation above (a second or third real
   review cycle hitting an invalid `changes_requested -> ready_for_review`
   transition — which, with a real backend configured, actually threw inside
   `handleSubmitReview`'s `mesa_submit_review` call on the *next* cycle, not
   just a silent skip) is fixed. Both `review-fix-loop` and
   `full-task-workflow`'s loop-back edges now re-enter through an
   `update_status -> in_progress` step before retrying `ready_for_review` /
   `reviewing`, matching the only transitions the protocol status graph
   (`packages/protocol/src/status.ts`) actually allows out of
   `changes_requested` / `approved`. `review-fix-loop`'s `step-6` (check
   fail) now loops to `step-1` instead of `step-2` — no new step needed,
   `step-1` already does the in_progress reset. `full-task-workflow` gained
   a new `step-fix-status` step between `step-fix` and
   `step-ready-for-review`. The 3-cycle count guard and stub/CI fallback
   behavior are unchanged; this only fixes what happens when a real verdict
   actually lands on cycles 2 and 3.

### Stage B — Connect real AI clients
2.5. **Real CLI invocation** — `done`. `ClaudeRunner`/`CodexRunner` now spawn the
   local AI CLI when `AGENTMESA_CLAUDE_CMD` / `AGENTMESA_CODEX_CMD` are set, via a
   shared shell-free `runCli` helper (`spawnSync`, prompt on stdin — no injection;
   5-minute default timeout). A missing binary or non-zero exit marks the run
   `failed`; when the env var is unset the runner falls back to the prompt-echo stub
   so CI and existing tests stay green with no token spend. Env-gated and
   non-breaking by design (auto-detect / always-on modes were rejected for
   token-burn and test-flakiness). This gives the orchestrator a real AI backend to
   drive; output parsing of review verdicts is still deferred to the plugin work.
3. **MCP server expansion** — `done`. `mcp-server` now exposes the full Stage-A
   surface in addition to tasks/messages/artifacts/meetings/agents: agent runs
   (`mesa_create_run` / `list` / `read` / `update_run_status`), run execution
   (`mesa_exec_run`, which drives the real Claude/Codex CLI when the runner env vars
   are set), workflows (`mesa_list_workflows` / `read_workflow` / `run_workflow`),
   handoffs (`mesa_request_handoff` / `submit_handoff_result` / `list_handoffs`), and
   the event/projection timeline (`mesa_list_events`, `mesa_get_task_events`,
   `mesa_get_meeting_events`, `mesa_get_task_projection`, `mesa_get_meeting_projection`).
   The hardcoded `roles:['custom']` + client-supplied actor id was replaced with an
   operator-configured actor (`AGENTMESA_MCP_ACTOR_ID` / `AGENTMESA_MCP_ACTOR_ROLES`,
   default `agent:mcp` / `builder`), and a `mesa-mcp` stdio bin launcher was added.
   Remaining Stage B items (Claude/Codex plugins) now have a complete MCP backend to
   drive.
4. **Claude plugin** — `done`. `@agentmesa/plugin-claude` now generates an integration
   that actually drives the shipped MCP surface. The launcher (`generateMcpConfig`) emits
   the `mesa-mcp` stdio bin with an env-configured actor (`AGENTMESA_MCP_ACTOR_ID` default
   `agent:claude`, `AGENTMESA_MCP_ACTOR_ROLES` default `builder`; node-fallback via
   `mcpServerPath` → `dist/bin.js`) — replacing the non-existent `node … serve --mcp`
   command. All generated CLAUDE.md rules, skills, and the CLI quick-reference use real
   tool names (`mesa_update_status`, `mesa_attach_artifact`, `mesa_request_review`,
   `mesa_request_handoff`, …) and real CLI subcommands (`mesa task show`, `mesa task
   status`, `mesa runs exec`, `mesa workflow run`) — the prior fictional names
   (`mesa_task_update`, `mesa_artifact_create`, `mesa_meeting_add_agent`, …) are gone. Two
   skills exercise the B.2 loop: `agentmesa-run` (`mesa_create_run` → `mesa_exec_run`) and
   `agentmesa-review` (`mesa_list_tasks` → `mesa_submit_review`); `agentmesa-handoff` now
   uses the handoff-loop tools. The Stop hook emits a benign reminder instead of an invalid
   `task update --auto-status` command.
5. **Codex plugin** — `done`. `plugins/codex` is now aligned to the same real MCP/CLI surface
   as the Claude plugin. `generateCodexMcpConfig` emits a `.codex/config.toml` snippet that
   launches the real `mesa-mcp` bin (or `node <mcpServerPath>` pointing at `dist/bin.js` when
   an explicit path is given) with an `[mcp_servers.agentmesa.env]` table carrying
   `AGENTMESA_MCP_ACTOR_ID` (default `agent:codex`) and `AGENTMESA_MCP_ACTOR_ROLES` (default
   `builder`) — the fictional `serve --mcp` args and the stale `dist/index.js` default are
   gone. `codex-exec-flow.ts` now checks task status via the real `mesa task show
   "${TASK_ID}" --json` (no `--mesa-dir` flag; the script `cd`s into the workspace root
   instead) and no longer tries to write the review report through a nonexistent `mesa
   artifact attach` command — submitting the verdict and attaching the report happen inside
   the Codex run itself via `mesa_submit_review` / `mesa_attach_artifact` MCP calls, per the
   `agentmesa-review` skill instructions (`review-skill.ts` already used correct tool names
   and needed no changes). `agents-md.ts` now tells the builder to use `mesa_update_status`
   instead of the fictional `mesa_transition_task`. Stage B is complete.

### Stage C — External integrations
6. **GitHub integration** — `done`. `@agentmesa/connector-github` was already real
   (`pr.ts`/`ci.ts` shell out to the actual `gh` CLI via `execSync`, exactly like the
   git connector shells out to `git`) but nothing could reach it — no CLI command, MCP
   tool, or orchestrator step ever called `listPullRequests`/`linkPrToTask`/
   `importCIResults`. That's now fixed: `mesa github link-pr <taskId> <prNumber>` /
   `mesa github import-ci <taskId>` (CLI) and `mesa_link_pr` / `mesa_import_ci_results`
   (MCP, in `packages/mcp-server`, which now depends on `@agentmesa/connector-github`)
   both call the real connector functions. **Not done, and intentionally deferred:**
   inbound GitHub webhook sync and a `GitHubTransport` registered in the transport
   registry — `docs/TRANSPORTS.md`'s "GitHub Transport (future)" section needs an actual
   HTTP/webhook receiving end before a transport implementation is anything but a sender
   with nowhere to send; building it now would be speculative infrastructure with no
   consumer.
7. **CI integration** — `done`. `MesaCheckResult` had a complete schema but was never
   created or read anywhere in the codebase. Added `@agentmesa/core`'s
   `check-result-service.ts` (`createCheckResult` / `getCheckResult` / `listCheckResults`,
   mirroring `agent-run-service.ts`: own `checksDir`, `check_completed` event — already in
   the event vocabulary, no new event type needed — `check.create`/`check.read` actions
   mapped to the existing `manage_runs` capability). `connector-github`'s `importCIResults`
   now maps every finished `gh run list` entry through the pure, unit-tested
   `ciStatusToCheckResultInput` and records a real `MesaCheckResult` per run (in addition
   to the pre-existing `test_result` artifact, kept for backward compatibility) —
   `mesa checks list|show` (CLI) and `mesa_create_check` / `mesa_list_checks` /
   `mesa_get_check` (MCP, source-agnostic — any caller can record a check, not just
   GitHub) read them back. Runs still in progress (`conclusion: null`) are skipped, not
   recorded as errors. **Not done:** a `CITransport` / webhook receiver — same reasoning
   as item 6, no HTTP endpoint exists yet to justify it.

### Stage D — Visualization
8. **Mesa Desk** — `done`. `packages/desk` was already real (`DeskServer` is a
   zero-dependency `node:http` server; `generateDashboardHtml()` is real embedded
   HTML/CSS/JS; all 14 pre-existing tests are genuine HTTP integration tests) but
   had two gaps, the same "code is real but nothing reaches it" pattern fixed for
   the Codex plugin in Stage B: no `mesa desk` CLI command, and no visibility into
   Stage A–C's new entities (agent runs, workflow status, handoffs, check results —
   only Task/Meeting/Agent/Artifact existed on the dashboard). Both are now fixed.
   `packages/orchestrator` gained `listWorkflowStates(ctx)` (mirrors
   `saveState`/`loadState`'s raw-fs read of `.agentmesa/logs/workflows/`, sorted
   newest-first — there was no "list all" before). `packages/desk` (now depending
   on `@agentmesa/orchestrator`) added four read-only routes — `GET /api/runs`
   (`listAgentRuns`), `/api/workflows` (`listWorkflowStates`), `/api/handoffs`
   (`{ outbound: listOutboundHandoffs, inbound: listInboundHandoffs }`, same shape
   as the MCP `handleListHandoffs` tool), `/api/checks` (`listCheckResults`) — and
   `/api/status` now also returns `runs`/`checks`/`handoffs` counts. The dashboard
   itself keeps its existing dark GitHub-style visual language (confirmed with the
   product owner rather than redesigned): four new cards (Agent Runs / Workflows /
   Handoffs / Check Results) with the same `.item`/`.item-title`/`.item-meta`/
   `.badge` structure as the pre-existing cards, new status-color badge classes
   reusing the existing semantic palette (green=passed/completed, red=error,
   blue=running, gray=pending/skipped), and the existing 30s `Promise.all` refresh
   loop now also fetches and renders the four new endpoints. `mesa desk [--port <n>]`
   (new `packages/cli/src/commands/desk.ts`) starts the server and prints the URL —
   the CLI's first long-running command (all others are one-shot), so it
   intentionally has no `--json`/automated test, matching the `gh`-CLI-dependent
   commands' testing tradeoff; verified instead by seeding a temp workspace with
   real task/run/workflow/check/handoff data and curling all four new endpoints
   plus `/` end-to-end. Tests: `listWorkflowStates` (3 new, orchestrator now 36),
   desk server routes (5 new, desk now 23 total across dashboard+server), dashboard
   card presence (4 new, desk dashboard.test.ts now 9).

Rationale: power the existing foundation first (Runner + Orchestrator make the
handoff loop run on its own), then onboard real AI participants (MCP + plugins),
then integrate outward (GitHub/CI), then build the UI. All four Post-Hardening
Sequence stages are now complete.
