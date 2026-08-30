# AgentMesa Deep Drivers

M4 "Deep Orchestration" adds **deep drivers** to the runner layer. A deep
driver wraps a *persistent, stateful agent session* (Claude Agent SDK, Codex
app-server) so AgentMesa can drive full agent sessions — multi-turn threads,
permission gates, interruption, and resume across processes — instead of only
firing one-shot CLI commands.

This document covers the driver contract, the two backends, the
selection/fallback rules, how permission requests are bridged, and the
separate opt-in switch for session collaboration runs.

## AgentDriver Contract

The contract lives in `packages/runner/src/drivers/types.ts` (frozen —
drivers implement it, the executor consumes it):

```ts
interface AgentDriver {
  readonly kind: 'claude-agent-sdk' | 'codex-app-server';
  readonly name: string;
  isAvailable(): Promise<boolean>;                                  // cheap, side-effect free probe
  createSession(init: DriverSessionInit): Promise<AgentDriverSession>;
  resumeSession(handle: DriverSessionHandle, init: DriverSessionInit): Promise<AgentDriverSession>;
}
```

A session runs one turn at a time:

```ts
interface AgentDriverSession {
  readonly kind: DriverKind;
  readonly backendSessionId: string;
  send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent>; // one turn
  respondPermission(requestId, 'allow' | 'deny', message?): Promise<void>;
  interrupt(): Promise<void>;   // drives the in-flight turn to a terminal event
  handle(): DriverSessionHandle; // serializable — persist and resume later
  close(): Promise<void>;
}
```

Turn events (`DriverEvent`): `text`, `thinking`, `tool_use`,
`permission_request`, `turn_complete` (terminal), `error` (optionally fatal).
While the event iterable is being consumed, pending `permission_request`s must
be answered via `respondPermission` or the turn stalls.

**Driver rules:**

- Drivers never require their backing binary/SDK at import time —
  `isAvailable()` is the availability probe.
- Drivers are transport-agnostic about Mesa: events and permission callbacks
  only. Policy enforcement (`assertPolicy`) and approval gates are wired by
  the caller (run-executor), never inside a driver.

## Backends

| Driver | Kind | Backing | Notes |
|---|---|---|---|
| Claude Agent SDK driver | `claude-agent-sdk` | `@anthropic-ai/claude-agent-sdk` | Full agent sessions with multi-turn threads, permission modes, and session resume by SDK session id. |
| Codex app-server driver | `codex-app-server` | Codex `app-server` | Codex conversations over the app-server protocol, resumed by conversation id. |

The registry is dependency-injected: `executeRun(ctx, runId, { driverRegistry })`.
Tests pass fakes; the application assembles real drivers in
`packages/runner/src/drivers/index.ts`. The executor never imports a concrete
driver implementation.

## Selection and Fallback

`resolveDriverTransport(preference, agent, registry)`
(`packages/runner/src/drivers/resolve.ts`) decides between the deep-driver
path and the legacy one-shot CLI runners:

| Preference | Registry state | Outcome |
|---|---|---|
| `cli` | anything | CLI runner, reason `driver preference set to cli`. |
| `auto` (default) | driver for the agent's `client` registered + available | Deep driver. `claude*` clients → `claude-agent-sdk`; `codex*` clients → `codex-app-server`. |
| `auto` | no driver mapping for the client (e.g. `remote`) | CLI runner, reason `no driver mapping for agent client "…"`. |
| `auto` | mapped driver missing or `isAvailable()` false (or throws) | CLI runner, reason `driver "…" not registered` / `driver "…" unavailable`. |
| `claude-agent-sdk` / `codex-app-server` | that driver registered + available | Deep driver (client field ignored). |
| `claude-agent-sdk` / `codex-app-server` | missing or unavailable | CLI runner, with the matching reason. |
| any | empty registry | CLI runner, reason `no deep drivers registered`. |

The preference source order: an explicit `driverPreference` argument → the
`AGENTMESA_DRIVER` environment variable (`auto|claude-agent-sdk|codex-app-server|cli`)
→ `auto`. Unknown values parse to `auto` (never crash the executor over a bad
env value).

Dry runs always take the CLI path (they execute nothing by design).

This resolution governs the **task-run** `executeRun` path only. Session
collaboration runs (meeting-invited agent speech) have their own independent
switch, `AGENTMESA_SESSION_DRIVER` — see
[Session Runs](#session-runs-conditional-deep-driver-opt-in-agentmesa_session_driver).

## Enabling (call-site wiring)

`AGENTMESA_DRIVER` is the single switch that turns deep drivers on at the
`executeRun` call sites — the MCP server (`mesa_exec_run`), orchestrator
workflow `run_agent` steps, and the CLI (`mesa runs exec`). All three build
their registry through `resolveDriverRegistryFromEnv()`
(`packages/runner/src/drivers/env.ts`):

| `AGENTMESA_DRIVER` | Registry handed to `executeRun` | Effect |
|---|---|---|
| unset / `auto` / unknown value | `createDefaultDriverRegistry()` (fresh instances) | Per-run selection by the agent's `client` (above). Unmapped client, missing or unavailable driver → CLI fallback, so default-on is behavior-preserving. |
| `cli` | `[]` (empty) | Deep drivers explicitly off — legacy CLI runners only. |
| `claude-agent-sdk` / `codex-app-server` | `createDefaultDriverRegistry()` | The executor resolves the same env var and targets that specific driver (client field ignored); unavailable → CLI fallback. |

Notes:

- Call sites never hardcode a `driverPreference` — the env var is the single
  source, so the switch semantics stay identical everywhere.
- The MCP tool schema is unchanged (the switch is environmental, not a tool
  argument), and workflow definitions gain no new fields.
- Every call constructs fresh driver instances: drivers own child processes /
  SDK handles, so a registry is never shared across executors.
- Permission bridging is wired at all three call sites: each builds its
  executor options with `attachPermissionResponder(...)` from
  `packages/runner/src/drivers/permission-bridge.ts`, so gated actions are
  judged by the policy engine under the **run's agent identity** (its
  registered roles) rather than blanket-denied. The one remaining gap is the
  human approval gate: no call site configures `askHuman` yet, so
  approval-required operations still fail closed (see
  [Permission Bridging](#permission-bridging)).

## Session Runs: Conditional Deep-Driver Opt-In (`AGENTMESA_SESSION_DRIVER`)

Meeting collaboration runs — a session agent invited into a meeting speaking
back into the timeline (`packages/runner/src/session-run.ts`) — get their own
switch, separate from `AGENTMESA_DRIVER`:

| `AGENTMESA_SESSION_DRIVER` | Effect on session runs |
|---|---|
| `cli` (default) | Session speech behaves exactly as before: a one-shot `claude -p` / `codex exec` cold start per speaking turn. |
| `auto` | Only claude-family agents (client starting with `claude`) go through the deep driver; codex-family agents stay on the CLI (until the Codex patch-approval wire-payload issue is fixed). |
| `claude-agent-sdk` / `codex-app-server` | Every session run is driven by that driver, regardless of client family. |

Two helpers, exported from the runner package, carry the semantics:

- `resolveSessionDriverPreference(env?)` — parses the env var with the same
  lenient rules as the task-run side (unknown values never crash a run).
- `shouldUseSessionDriver(preference, agentClient)` — decides per agent
  whether the speaking turn takes the deep-driver path.

**Why a separate switch.** The session path deliberately does **not** inherit
the `AGENTMESA_DRIVER` global default. Once the Claude Agent SDK is installed,
`isAvailable()` is always true — if `auto` silently applied to session runs,
every claude-family member's meeting speech would flip to deep-driver turns
overnight. An independent, default-`cli` switch keeps the rollout gradual and
opt-in per deployment.

**Behavior when a session run goes deep:**

- The resume handle is keyed by `meetingId` (the scope rules in
  [Session Resume](#session-resume) already provide this), so a member threads
  across speaking turns within one meeting — cross-turn memory.
- Permission requests pass through the same policy bridge, judged by the
  **agent's registered roles**: read-only tools are allowed; `Bash` / `Write`
  are judged against the role capability table. No `askHuman` gate is wired
  for session runs either — approval-required operations fail closed.
- Output is still written back into the meeting timeline under the agent's
  identity; the deep driver only changes how the turn is executed, not how the
  reply is delivered.

**Phase 1 scope** is claude-family only (`auto` maps codex-family to CLI) and
speaking turns passing through the permission bridge.

**Roadmap (planned, not yet built):** Phase 2 tightens session speech to a
read-only fence (speaking turns restricted to read-only tool use unless a
meeting-level capability says otherwise) and wires the `askHuman` bridge so
approval-gated actions surface to a human over Desk instead of failing closed.

**Two switches, no linkage.** `AGENTMESA_SESSION_DRIVER` and `AGENTMESA_DRIVER`
are independent: the former governs only session collaboration runs and
defaults to `cli`; the latter governs the task-run `executeRun` call sites.
Setting one never changes the behavior of the other.

## Run-Executor Integration

`executeRun` (packages/runner/src/run-executor.ts) keeps the run state machine
unchanged — `pending → running → completed | failed` — and picks the transport
after marking the run `running`:

1. Inject a non-empty `driverRegistry` and resolve the transport (above).
2. **Driver path**: resume the persisted session handle for this agent+scope
   when possible, otherwise `createSession`; run one turn with `run.input` as
   the prompt; map events to `RunProgress`; persist the resulting handle;
   close the session. Output becomes the run output (and `agent_run_log`
   artifact on success), exactly like a CLI run.
3. **CLI path** (preference `cli`, driver unavailable, empty registry, dry
   run): byte-for-byte the pre-M4 behavior — the legacy runner is invoked with
   the same options and progress stages.

Event → progress mapping (`RunProgress` shape, stage names):

| DriverEvent | RunProgress stage |
|---|---|
| turn start | `driver_session` (percent 10) |
| `text` | `agent_message` |
| `thinking` | `agent_thinking` |
| `tool_use` | `tool_use` (`tool: <input summary>`) |
| `permission_request` | `permission_request`, then `permission_granted` / `permission_denied` |
| non-fatal `error` | `driver_error` |
| terminal | the standard `persisting_artifact` / `completed` / `failed` stages |

Timeouts and interrupts reuse the existing run state machine: the driver
turn's wall-clock budget is the run `timeout`; on expiry the executor calls
`session.interrupt()`, keeps draining events for a short grace period, and
fails the run with a timeout note.

## Session Resume

`DriverSessionHandle { kind, backendSessionId, createdAt }` is serializable.
Because the core `MesaAgentRun` record is schema-validated (unknown fields are
stripped) and out of scope for M4 wiring, handles are persisted as a sidecar
store instead of inside the run record:

- Location: `.agentmesa/driver-sessions/<sanitized-agentId>.json` (atomic
  temp+rename writes).
- Scope: one handle per **agent + scope**, where scope is the run's
  `meetingId`, else `taskId`, else a global bucket — a session threads within
  one meeting, never across meetings.
- On the next `executeRun` for the same agent and scope, the executor resumes
  the saved handle (same driver kind only; kind mismatch, missing, corrupted,
  or failing resume → fresh `createSession`).
- The handle is persisted after every turn (success or failure) and the
  session is then closed; resume relies on the backend's own session
  persistence (SDK session id / app-server conversation id).

`executeDriverTurn(ctx, params)` is exported directly (runner package root) so
the CLI and Desk can drive a deep-driver turn without going through an agent
run.

## Permission Bridging

Deep-driver permission requests are answered through an injected responder:

```ts
type DriverPermissionResponder =
  (request: DriverPermissionRequest) => Promise<'allow' | 'deny'>;
```

- `DriverPermissionRequest` carries `requestId`, `kind`
  (`tool|command|patch`), a human-readable `title`, and the raw `detail` for
  policy evaluation.
- The responder is passed as `executeRun`'s `permissionResponder` option (or
  `executeDriverTurn`'s parameter). Without one, the executor's built-in
  default still **denies everything** (`Denied by AgentMesa policy`) — deep
  drivers fail closed.
- The real bridge is `createPolicyPermissionResponder(options)` /
  `attachPermissionResponder(executorOptions, { ctx, ... })` in
  `packages/runner/src/drivers/permission-bridge.ts`. It judges every request
  through the `@agentmesa/policy` checkers:
  - `command` — blocked-pattern / secret-path scan → `run_command` role
    capability (checked *before* the approval gate, so a human approval can
    never upgrade a role) → approval-required patterns → command allowlist.
  - `patch` — secret-path scan → `FileAccessChecker` write-scope rules per
    role (paths relativized against the workspace root); unparsable payload →
    deny.
  - `tool` — tool name → policy action (`Write`/`Edit` → modify_source,
    `Bash` → run_command, …) judged by role capability; known read-only tools
    pass, unknown tools are denied; `ctx.policy` is consulted as a second
    opinion for actions with a core mapping.
  - Any parse failure, unknown payload structure, or thrown error inside the
    bridge resolves to deny. Every decision is reported through the optional
    `onDecision` callback as an auditable `PermissionDecisionRecord`.
- All three `executeRun` call sites (CLI `mesa runs exec`, MCP
  `mesa_exec_run`, orchestrator `run_agent` steps) assemble the responder via
  `attachPermissionResponder`, evaluating gated actions under the run's agent
  identity (the agent's registered roles), not the calling actor.
- **Human approval gate (`askHuman`)** — wired as of Phase 2 (2026-08-30):
  - Desk session runs pass `createDeskAskHuman(...)` backed by
    `PermissionApprovalQueue` (`packages/desk/src/permission-approvals.ts`) —
    pending approvals surface in the client Approvals view
    (`GET /api/permissions/pending`, `POST /api/permissions/:id/decide`),
    300s auto-deny timeout. With the session speech guard active this never
    fires (mutative actions are denied before the approval gate); the wiring
    is ready for when the guard is relaxed per role/config.
  - CLI `mesa runs exec` asks in the terminal (`y/N`); non-interactive stdin
    denies (fail-closed, same as having no gate).
  - MCP task runs still pass no gate — the MCP caller is an agent with no
    human waiting; approval-required operations deny fail-closed.
- **Session speech guard (`speechGuard: true`)** — both session-run call sites
  (MCP `mesa_activate_session_agent`, Desk invite) enable it: meeting-speech
  turns are read-only for every role (owner included). Patches deny
  (`speech.patch_denied`); commands narrow to a readonly allowlist
  (`SPEECH_READONLY_COMMANDS`); tools mapping to `modify_source` /
  `push_code` / `merge_pr` / `run_command` deny (`speech.tool_denied`).
  State changes go through task → run → approval (COLLAB_VISION routing
  rule 1, extended to the tool layer).

## Implementation Status

| Component | Status |
|---|---|
| Driver contract (`drivers/types.ts`) | **Done.** Frozen contract; events, permission requests, handles, resume. |
| Claude Agent SDK driver backend | **Done.** Real sessions, multi-turn threads, resume by SDK session id; assembled in `drivers/index.ts`. |
| Codex app-server driver backend | **Done.** App-server conversations, resume by conversation id; assembled in `drivers/index.ts`. |
| Selection + CLI fallback (`drivers/resolve.ts`) | **Done.** Preference parsing (`AGENTMESA_DRIVER`), client mapping, availability probing, fallback reasons. |
| run-executor integration | **Done.** Driver turn path, event→progress mapping, timeout/interrupt, artifact persistence; CLI path byte-identical. |
| Handle persistence + resume | **Done.** Sidecar store under `.agentmesa/driver-sessions/`, per agent+scope resume, resume-failure fallback. |
| Permission bridging (`drivers/permission-bridge.ts`) | **Done.** Policy-engine responder (`createPolicyPermissionResponder` / `attachPermissionResponder`) wired at all three `executeRun` call sites. The `askHuman` human approval gate is not configured at any call site yet — approval-required operations fail closed. |
| Real driver assembly (`drivers/index.ts`) | **Done.** `createDefaultDriverRegistry()` builds the real Claude SDK + Codex app-server drivers. |
| Env switch + call-site wiring (`drivers/env.ts`) | **Done.** `AGENTMESA_DRIVER` gates the registry at the MCP server / orchestrator / CLI call sites; `cli` disables deep drivers. |
| Session-run deep-driver opt-in (`AGENTMESA_SESSION_DRIVER`) | **Done.** Default `cli`; `auto` claude-family only; explicit kinds full; unregistered agent ids fall back to CLI. Speech guard on; Desk askHuman bridge wired. |
| Speech guard (`permission-bridge.ts`) | **Done.** `speechGuard` option: read-only meeting-speech turns for every role. |
| askHuman bridges | **Done.** Desk `PermissionApprovalQueue` + client approval cards; CLI terminal gate on `mesa runs exec`. |

## Live codex integration notes (2026-08-30, codex-cli 0.131.0 on Windows)

Verified against a real `codex app-server` binary:

- **Wire protocol compatible.** `initialize` / `initialized` /
  `thread/start` (with `approvalPolicy: 'on-request'`) / `thread/started` all
  round-trip in the shapes the driver expects; the real `thread/start`
  response echoes `approvalPolicy: "on-request"`, `approvalsReviewer: "user"`,
  sandbox info, and a UUID thread id. Full handshake completed successfully
  through the driver twice (session created, handle persisted, clean close).
- **`thread/start` intermittently wedges on this machine.** The dev box runs
  two resident IDE `codex app-server` instances plus 8+ configured MCP
  servers (some failing: missing `GITHUB_PAT_TOKEN`, a broken
  `models_cache.json` carrying post-0.131.0 `max` effort values). Under that
  load the driver's `thread/start` frequently times out (even at 180s), while
  a hand-rolled byte-identical client succeeds within ~5s in the same
  minute — reproduced side-by-side. Every variable was bisected (spawn form,
  `env`, readline, wire bytes, timing, locks, cache, process-tree kills,
  cooldown): none reproduces it. Root cause is open — likely below the JS
  layer (node/libuv/cmd shim interaction). Mock-based tests stay green; a
  clean environment (no resident instances, fewer MCP servers) is expected
  to behave.
- **Windows orphan fix.** Killing the cmd.exe shim leaves the real
  `codex.exe` grandchild orphaned; each stray app-server competes for
  `~/.codex` state. The connection now kills the whole tree
  (`taskkill /pid <pid> /T /F`) on the shell-shim path.
