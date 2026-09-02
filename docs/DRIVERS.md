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
- **Credential passthrough caveat (observed live 2026-09-02).** Host-managed
  auth is NOT inherited by the SDK child processes desk spawns: a host app
  that keeps its Anthropic credentials in `settings.json` `env`
  (`ANTHROPIC_AUTH_TOKEN`) must inject that variable into the desk process
  explicitly, or every deep-driver turn dies on authentication. Users who
  sign in through the regular `claude` login flow are unaffected — only
  hosts that intercept auth (e.g. AI Mana) need the injection.

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

## Adopting external sessions

Phase 2 of the external-session import surface adds **adoption** (session
takeover): importing a session that was created *outside* AgentMesa can
optionally seed the driver-session sidecar so that later deep-driver turns for
that meeting **resume the original external session** instead of cold-starting
a new one.

- **Entry point.** `POST /api/meetings/import` with `adopt: true` (Desk
  `importExternalSession(config, source, sessionId, true)` in the client). The
  desk maps the source to the synthetic external agent
  (`agent:claude-external` / `agent:codex-external`) and the driver kind
  (`claude` → `claude-agent-sdk`, `codex` → `codex-app-server`), then calls
  `adoptExternalDriverSession(ctx, { agentId, scope: meetingId, kind,
  backendSessionId, claudeProjectsRoot })` (exported from the runner package
  root). Adoption only writes the handle — it never activates the agent or
  starts a run; the next invited speaking turn picks the handle up naturally
  through the normal resume path.
- **Scope.** The handle is keyed by `scope = meetingId`, so adoption is
  per-meeting, exactly like a native handle. Adopting into a second meeting
  writes a second scope entry in the same sidecar record.
- **Fail-loud precheck, fail-soft endpoint.** `adoptExternalDriverSession`
  throws on invalid input and — for `claude-agent-sdk` — when the local
  transcript (`<projects-root>/<slug>/<sessionId>.jsonl`, one-level scan) is
  missing, because SDK resume replays that JSONL and a missing file guarantees
  a dead handle. The desk endpoint catches the throw and degrades: the import
  snapshot (meeting + messages) still succeeds with `201`, the response just
  reports `adopted: false` plus `adoptError`. Codex has no synchronous local
  artifact to probe, so an invalid thread id surfaces at resume time.
- **Adoption precheck endpoint (`POST /api/imports/precheck`, Phase 3).**
  Probe whether `adopt=true` would actually hold BEFORE importing — read-only,
  nothing is persisted. Claude re-runs the transcript probe; codex runs a live
  `thread/resume` probe (`CodexAppServerDriver.probeResume`: spawn app-server
  → handshake → resume → close, no session created, no turn driven) plus a
  stray-process census (`tasklist`-counted `codex.exe` on Windows — resident
  IDE app-servers and orphans alike compete for `~/.codex` state, so any
  count > 0 becomes a warning). The import dialog fires this when the user
  ticks 接管续跑 and shows the verdict inline (通过 / 未通过 + 原因 / 流浪进程
  警告). Verified against the real binary: an invalid thread id fails the
  probe with the server's own error (`invalid thread id: …`), so a takeover
  that cannot hold is visible before the user commits to it.
- **Strict resume.** `executeDriverTurn` (and the `RunExecutorOptions` /
  `SessionRunOptions` / `ActivateSessionAgentOptions` that funnel into it)
  accepts `resumeMode: 'fallback' | 'strict'` (default `fallback`). This
  matters most for adopted handles: in `fallback` mode a kind mismatch or a
  failing resume silently starts a fresh session — the takeover quietly
  degrades to a new conversation. `strict` fails the turn instead (kind
  mismatch, or the resume RPC/transcript replay failing), so a broken takeover
  is visible rather than silent. With *no* persisted handle both modes behave
  identically (fresh session).
- **Adopted handles activate strict automatically.** Handles seeded by
  `adoptExternalDriverSession` carry an `adopted: true` marker. When desk
  activates a meeting agent that has an adopted handle for the meeting scope,
  it passes `resumeMode: 'strict'` without any env switch — organic
  (Mesa-grown) handles keep `fallback`. A strict failure is also *visible*:
  the failed run gets a failure bubble written back into the meeting timeline
  (not only server logs / the status drawer), and the client audit trail maps
  the `failed` progress stage to a `运行失败：…` activity line.
- **The `adopted` marker persists across turns.** Driver sessions rebuild
  their handle from live state and would drop the marker, so the run executor
  carries `adopted: true` from the saved handle into every handle it persists
  after a successful turn (2026-09-02). Without this, the first successful
  round silently cleared strict semantics and a *later* broken resume (e.g.
  the external transcript was deleted) fell back to a stranger session.
- **Precondition: `AGENTMESA_SESSION_DRIVER`.** Adoption only does anything
  when session runs actually take the deep-driver path. The default `cli`
  mode keeps meeting speech on one-shot CLI runners that never read the
  sidecar, so the desk response carries `driverMode` and an `adoptWarning`
  when a handle was seeded while `AGENTMESA_SESSION_DRIVER=cli`. Set it to
  `claude-agent-sdk` / `codex-app-server` / `auto` for the takeover to take
  effect. The session-run registry follows this switch alone
  (`resolveSessionDriverRegistry`): `AGENTMESA_DRIVER=cli` (the task-run
  switch) can no longer silently empty the session registry and degrade a
  takeover back to one-shot CLI turns.

**Failed-attempt transcript pollution (known side effect).** The Claude CLI
appends the user prompt line to the local JSONL transcript as soon as it
starts — *even when the turn then fails* (observed live 2026-09-01: a failed
strict-resume attempt grew the external transcript from 20 to 33 lines;
authentication failures also write). AgentMesa cannot prevent this write, and
rolling the file back is unsafe (the external client may be writing
concurrently), so the mitigation is disclosure: a failed turn on an adopted
claude handle appends a note to the run output telling the user the external
transcript may have gained a stray prompt line.

**Concurrency and takeover risks.** An adopted session may still be in use by
its native client (a Claude Code terminal that is mid-conversation, a running
codex app-server thread). Two writers on one backend session can interleave
turns or clobber each other's state; the client surfaces an "active session"
warning on the import list, but nothing enforces exclusivity.

**Unverified — needs live validation:**

- Claude resume against a real `~/.claude/projects` JSONL created by another
  client (the local-transcript dependency is probed at adopt time; actual
  cross-client resume fidelity is untested).
- Behavior when the adopted session is concurrently driven by its original
  client (interleaving, transcript locking, or hard failure).
- Near-full-context overflow when resuming a very long external session (the
  backend may refuse the resume or truncate; no mitigation is wired).
- ~~The external thread's `approvalPolicy` / permission posture carries over
  from the original session; how that interacts with AgentMesa's policy
  bridge on the first resumed turn is not yet observed.~~ Resolved by the
  2026-09-01 probes: resume neither persists nor echoes an approvalPolicy, so
  the driver now lifts every `requirePermissions` turn onto
  `approvalPolicy: 'on-request'` — the posture question is settled at the
  turn level (see "Live codex approval-posture probes").

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
    300s auto-deny timeout. Phase 3 (2026-09-01) made this gate live for
    speech turns: gated speech actions escalate here as approval cards.
  - CLI `mesa runs exec` asks in the terminal (`y/N`); non-interactive stdin
    denies (fail-closed, same as having no gate).
  - MCP task runs still pass no gate — the MCP caller is an agent with no
    human waiting; approval-required operations deny fail-closed.
- **Session speech guard (`speechGuard: true`) — approval posture (Phase 3,
  2026-09-01)** — meeting-speech turns are read-only **by default** for every
  role (owner included). Read-only commands (`SPEECH_READONLY_COMMANDS`) and
  read-only tools pass through. Gated actions — patches
  (`speech.patch_approval_required`), non-read-only commands
  (`speech.command_approval_required`), and tools mapping to `modify_source` /
  `push_code` / `merge_pr` / `run_command` (`speech.tool_approval_required`)
  — escalate to the `askHuman` gate as approval cards instead of being
  silently denied, and the human decision wins (audited as `human.approved` /
  `human.denied` with `viaHuman: true`). Without an askHuman gate configured
  they fail closed (`approval.required`). This replaced the old hard-deny
  fence, which deadlocked adopted coordinator sessions: a resumed external
  coordinator dispatching work to its child sessions was either blocked by
  the fence or ran with no audit constraint — read-only-by-default + human
  approval keeps both coordination and audit.
- **Meeting trust levels (2026-09-02)** — the guard is now a per-meeting
  posture, not a constant. `MesaMeeting.trustLevel` (`'approval'` default |
  `'trusted'`, set via `PATCH /api/meetings/:id/trust-level`, policy action
  `meeting.updateTrustLevel` → `manage_meetings`):
  - `approval`: `speechGuard: true` — exactly the posture above.
  - `trusted`: `speechGuard: false` — the human's explicit decision that
    writes in this meeting are judged by the agent's **role capabilities**
    (capability table + file-access scope) without per-action approval cards.
    Both activation paths (Desk invite and MCP `mesa_activate_session_agent`)
    read the level when building the responder; the level applies to runs
    activated after the change (a posture is fixed at responder construction).
    On the MCP path there is still no `askHuman` gate, so `approval`-level
    gated actions fail closed there either way.
  - **What does NOT change at `trusted`**: blocked-pattern commands and
    secret-path checks (they run before the fence at both levels);
    `unknownToolPolicy` stays `deny`; and — deliberately —
    `requirePermissions` stays **true** on both levels. The codex read-only
    sandbox + `approvalPolicy: 'on-request'` and the claude
    `permissionMode: 'default'` are what keep every gated action flowing
    through the permission bridge; relaxing the sandbox to workspace-write
    would make codex execute workspace writes with zero approval round-trips
    (verified live), bypassing the Mesa policy engine entirely. A trusted
    write therefore costs one local JSON-RPC approval round-trip that the
    bridge auto-answers from the capability table — no human in the loop,
    every write still judged and audited. (Follow-up option if live testing
    ever shows this round-trip hurts codex behavior: decouple
    `DriverSessionInit.sandbox` and accept the audit downgrade — documented
    here, deliberately not built.)
- **Session approval grants (`allow_session`, 2026-09-02)** — the desk
  approval card offers a third decision, 本会话允许: it resolves the current
  request as allow **and** records a `(meetingId, kind)` grant so subsequent
  requests of the same kind in that meeting skip the queue entirely (no card,
  no 5-minute auto-deny timer). Grants live in the `PermissionApprovalQueue`
  only — never persisted, revoked by desk restart / `clear()`. Grant hits are
  logged as `permission.session_grant_hit` to distinguish them from a human
  clicking 允许.

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
| External-session adoption (`drivers/adopt.ts`) | **Done.** Desk import `adopt: true` seeds the sidecar handle (`adoptExternalDriverSession`) with the `adopted` marker; desk activation passes `resumeMode: 'strict'` for adopted handles (fail-loud takeover) and strict failures surface as meeting-timeline failure bubbles. `POST /api/imports/precheck` probes adoption before import (codex live resume probe + stray-process census; claude transcript probe). Live cross-client resume behavior unverified (see the adoption section). |
| Speech guard (`permission-bridge.ts`) | **Done.** `speechGuard` option: read-only-by-default meeting-speech turns for every role; gated actions escalate to the askHuman approval gate (desk approval cards) instead of hard-denying — the takeover deadlock fix (Phase 3). Per-meeting trust levels (2026-09-02): `trusted` meetings drop the fence and let role capabilities judge writes (blocked-pattern / secret-path / requirePermissions unchanged at both levels). |
| askHuman bridges | **Done.** Desk `PermissionApprovalQueue` + client approval cards (now with the `allow_session` third decision and `(meetingId, kind)` session grants); CLI terminal gate on `mesa runs exec`. |

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

## Live codex approval-posture probes (2026-09-01, codex-cli 0.131.0 on Windows)

Probed against a real `codex app-server` (three throwaway JSON-RPC sessions,
probe scripts archived under `.tmpfiles/codex-approval-probe/`):

- **`thread/resume.excludeTurns` requires the experimentalApi capability.**
  Without `capabilities: { experimentalApi: true }` on `initialize`, the
  server rejects the resume outright: *"thread/resume.excludeTurns requires
  experimentalApi capability"*. The driver previously never declared the
  capability, so **every production codex resume was failing** (surfacing as
  a strict-resume failure for adopted handles). Fixed: the driver's
  `initialize` now declares `capabilities: { experimentalApi: true }` —
  with it, the same resume proceeds to rollout lookup.
- **`thread/resume` does NOT persist an approvalPolicy.** The parameter is
  accepted (no invalid-params error) but the response thread echoes
  `approvalPolicy: undefined` either way — resume cannot lift the posture.
- **`turn/start` accepts a turn-level `approvalPolicy`.** No schema rejection;
  the turn runs. The driver therefore lifts every `requirePermissions`
  session's turns onto `approvalPolicy: 'on-request'` — for freshly created
  threads this matches the thread posture (no-op), and for **resumed
  external sessions it is the only reliable posture lift** (the takeover
  approval-escalation path).
- **Behavioral caveat (unverified).** The probe machine's default model
  (`gpt-5.6-sol`) 400s on turn execution (needs a feature the local config
  lacks), so the end-to-end "on-request turn → `item/commandExecution/
  requestApproval` arrives → desk approval card" chain was not observed
  live; it is covered by mock-based tests and awaits the Phase 3
  integration checklist run on a healthy model config.

## Live codex approval chain + sandbox fence (2026-09-02, codex-cli 0.152.0 on Windows)

The model recovered (`gpt-5.6-sol` answers turns again), so the deferred
Step 9 behavioral run finally happened — and it caught a real fence bypass:

- **The default sandbox silently bypasses the approval fence.** First live
  run: a meeting turn asked codex to create a workspace file; the turn
  completed, the file appeared, the write-back bubble posted — and **zero**
  approval requests fired. Root cause: codex's default sandbox
  (`workspace-write`) executes writes inside the workspace WITHOUT any
  `requestApproval`, so `approvalPolicy: on-request` only gates
  out-of-sandbox actions. AgentMesa's speech-guard fence (every gated action
  human-reviewed) never saw the write.
- **Fix: pin `sandbox: 'read-only'` whenever `requirePermissions` is set.**
  Wire probes against the real 0.152.0 server: `thread/start` and
  `turn/start` both accept a `sandbox` string (`read-only` |
  `workspace-write` | `danger-full-access`; an object form is rejected with
  the variant list). With `read-only`, a file write reliably produces
  `item/fileChange/requestApproval` (and shell writes
  `item/commandExecution/requestApproval`).
- **A plain `{decision: "accept"}` is sufficient.** Verified live: answering
  the approval with a bare accept (no `updatedSandbox` escalation) lets the
  approved write execute. The existing `respondPermission` path needs no
  change.
- **Full chain re-verified live after the fix:** meeting turn → codex
  write attempt → `patch: exec-…` approval card in
  `GET /api/permissions/pending` → `POST /api/permissions/:id/decide
  {decision:"allow"}` → file created → run completed → write-back bubble.
  Probe workspace and scripts: `.tmpfiles/codex-approval-probe-20260902/`.
