# Agent Runs

Agent runs represent individual work sessions executed by an agent within the AgentMesa meeting layer. Each run records what an agent was asked to do, its status, and the resulting output.

## Domain Model

```
MesaAgentRun {
  id:                 string          // run_<uuid8>
  protocolVersion:    "0.2.0"
  taskId?:            string          // optional parent task
  meetingId?:         string          // optional parent meeting
  agentId:            string          // who performed the run
  action:             RunAction       // implement | review | fix | test | document | plan | custom
  runnerType?:        string          // explicit execution backend (overrides action mapping)
  status:             RunStatus       // pending | running | completed | failed | cancelled
  input:              string          // what the agent was asked to do
  inputSummary?:      string          // brief input summary
  output?:            string          // full output text
  outputSummary?:     string          // brief output summary
  error?:             string          // error message if failed
  producedArtifactIds: string[]       // artifacts created during this run
  startedAt:          string (ISO)    // creation / start timestamp
  completedAt?:       string (ISO)    // when run finished
  duration?:          number (ms)     // wall-clock duration
}
```

## Run Actions

| Action     | Description                    |
| ---------- | ------------------------------ |
| implement  | Build/implement a feature      |
| review     | Review code or artifacts       |
| fix        | Fix a bug or issue             |
| test       | Run tests or verify            |
| document   | Write documentation            |
| plan       | Plan or design work            |
| custom     | Other agent-specific action    |

## Run Status Lifecycle

```
pending → running → completed
                 → failed
                 → cancelled
```

A run is created in `pending` status. It transitions to `running` when work begins, then to `completed` (success), `failed` (error), or `cancelled` (abandoned).

On terminal states (`completed` / `failed` / `cancelled`), `completedAt` and `duration` are automatically recorded.

## Events

Every agent run mutation emits an append-only event:

| Event Type                    | Trigger                              |
| ----------------------------- | ------------------------------------ |
| `agent_run_created`           | `createAgentRun()`                   |
| `agent_run_status_changed`    | `updateAgentRunStatus()` — any transition |
| `agent_run_completed`         | `updateAgentRunStatus()` → completed |
| `agent_run_failed`            | `updateAgentRunStatus()` → failed    |

All events are written to the append-only event log at `.agentmesa/events/events.jsonl`.

## Core Service API

```ts
// Create a new agent run
createAgentRun(ctx, {
  agentId: string,
  input: string,
  taskId?: string,
  meetingId?: string,
  action?: RunAction,   // default 'implement'
})

// Update run status (optionally attach output/artifacts)
updateAgentRunStatus(ctx, runId, status, patch?)

// Read
getAgentRun(ctx, runId)
listAgentRuns(ctx, filter?)

// Filter by: taskId, agentId, status
```

## CLI

```bash
mesa runs create <input>              # Create a new run
mesa runs list [--agent <id>]         # List all runs
               [--task <id>]
               [--status <status>]
mesa runs show <id>                   # Show run details
mesa runs complete <id>               # Mark as completed manually
              [--output <summary>]
              [--artifact <id>]
mesa runs exec <id>                   # Execute a pending run via a runner backend
              [--dry-run]
```

`mesa runs create` also accepts `--runner <type>` to pin an explicit execution
backend (see Execution below).

All commands support `--json` for programmatic consumption.

## Execution (Runner Automation)

`mesa runs complete` only records a terminal status. To actually *run* a pending
run through a backend, use the executor:

```ts
executeRun(ctx, runId, { dryRun?, createArtifacts?, timeout? })
// → { run: MesaAgentRun, result: RunResult }
```

`executeRun` drives a `pending` run `pending → running → completed | failed`:

1. Loads the run (throws `RunNotFoundError` if missing); throws `VALIDATION_ERROR`
   if the run is not `pending`.
2. Resolves the backend via `resolveRunnerType(run)`.
3. Transitions the run to `running` (gated by `run.updateStatus` → `manage_runs`).
4. Invokes the backend through the stable `createRunner(type, paths, dryRun)` factory.
5. On a thrown error → marks the run `failed` (with `error`) and rethrows.
   On `result.success === false` → marks `failed` and returns.
   On success → optionally persists output as an `agent_run_log` artifact, parses
   an `outputSummary`, and marks the run `completed`.

### Backend resolution

An explicit `run.runnerType` wins when it is a valid `RunnerType`. Otherwise the
`action` is mapped to a default backend:

| action               | RunnerType          |
| -------------------- | ------------------- |
| `implement`          | `claude-implement`  |
| `fix`                | `claude-fix`        |
| `review`             | `codex-review`      |
| `test`               | `codex-test`        |
| `document`           | `document`          |
| `plan` / `custom`    | `claude-implement`  |

The `shell-check` backend has no `action` mapping — target it explicitly with
`mesa runs create "<command>" --runner shell-check`, which executes an
allowlisted shell command for real.

> **Scope:** the Shell backend executes for real. The Claude/Codex backends
> currently echo the constructed prompt as their output (the run lifecycle,
> artifact persistence, and handoff loop are fully wired); spawning the actual
> Claude/Codex CLI subprocess is deferred to the plugin milestone.

### Artifact persistence

On a successful non-dry run, `executeRun` writes the run output as an
`agent_run_log` artifact (`text/markdown`) and records its id in
`producedArtifactIds`. Artifact creation is skipped on `dryRun` and when
`createArtifacts: false`.

## FileTransport Handoff Loop

Agent runs participate in handoff workflows via transport envelopes:

```
AI A completes artifact
  → writes review_request envelope to outbox

AI B reads outbox
  → writes review_result envelope to inbox

AI A reads inbox → continues or fixes
```

### Handoff Service API

```ts
writeReviewRequest(ctx, {
  taskId, runId, artifactId,
  requestedReviewer, summary
})
// → writes outbound envelope to .agentmesa/outbox/

writeReviewResult(ctx, {
  taskId, runId, artifactId,
  reviewer, verdict, summary, detail?
})
// → writes inbound envelope to .agentmesa/inbox/

listOutboundHandoffs(ctx)  // read outbox
listInboundHandoffs(ctx)   // read inbox
```

### Envelope Payload

**review_request** (outbound):
```json
{
  "taskId": "task_xxx",
  "runId": "run_xxx",
  "artifactId": "artifact_xxx",
  "requestedReviewer": "codex",
  "summary": "Please review the login implementation"
}
```

**review_result** (inbound):
```json
{
  "taskId": "task_xxx",
  "runId": "run_xxx",
  "artifactId": "artifact_xxx",
  "reviewer": "codex",
  "verdict": "approved | changes_requested | rejected",
  "summary": "LGTM",
  "detail": "Consider adding more tests"
}
```

## Policy

Agent runs are governed by the following policy actions:

| Action             | Capability    | Roles with access                                   |
| ------------------ | ------------- | --------------------------------------------------- |
| `run.create`       | `manage_runs` | owner, admin, builder, reviewer, chair, maintainer, planner, tester, ci |
| `run.updateStatus` | `manage_runs` | same as above                                       |
| `run.read`         | `manage_runs` | same as above                                       |

Roles without `manage_runs`: documenter, researcher, custom, system, connector.

## Storage

Agent run objects are stored as JSON files at `.agentmesa/runs/<runId>.json`. Mutations follow the standard atomic-write pattern (temp → fsync → rename) via the storage adapter.

## Current Status

RUN-001: Agent Run lifecycle + FileTransport handoff minimal closed loop — **complete**.

Stage A.1 (Runner automation): `executeRun` + `mesa runs exec` — **in progress**.
The executor, backend resolution, artifact persistence, and the Shell backend's
real execution are done; spawning the real Claude/Codex CLI subprocess is
deferred to the plugin milestone.
