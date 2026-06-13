# AgentMesa Event-Sourced State Model

AgentMesa uses an event-sourced architecture to preserve a complete, append-only audit trail of every action across all agents, meetings, and tasks.

## Current Implementation Status

`FileEventStore` is the default event store backing `MesaRuntimeContext`. It persists every
runtime event as a single-line JSON object appended to `.agentmesa/events/events.jsonl`.
Events survive process exit and are readable across `createRuntimeContext` calls.

Core services — task create/status/assignment/deletion, meeting create/status/membership
changes, message append, artifact creation, agent registration — all append protocol events
through the file store.

Minimal projection rebuild is implemented via `projection-service.ts`:
- `rebuildTaskProjections(ctx)` replays task events (task_created, task_status_changed,
  task_assigned, task_deleted / task_archived → tombstone) and writes to `.agentmesa/projections/tasks/<id>.json`.
- `rebuildMeetingProjections(ctx)` replays meeting events (meeting_created,
  meeting_status_changed, meeting_task_added, meeting_agent_added) and writes to
  `.agentmesa/projections/meetings/<id>.json`.
- `rebuildAgentProjections(ctx)` replays agent events (agent_registered) and writes to
  `.agentmesa/projections/agents/<id>.json`.
- `rebuildAllProjections(ctx, { clean })` runs all three. With `{ clean: true }`, stale
  projections (files not backed by any event stream) are removed before rebuilding.
- Replay is deterministic: events are sorted by `sequence`, then `timestamp`, then `id`.

Projection read services are available via `projection-read-service.ts`:
- `getTaskProjection(ctx, id)` / `getMeetingProjection(ctx, id)` / `getAgentProjection(ctx, id)`
  return a single rebuilt projection or `null` if not found.
- `listTaskProjections(ctx)` / `listMeetingProjections(ctx)` / `listAgentProjections(ctx)`
  return all rebuilt projections in the category.

Projection freshness checks:
- `isTaskProjectionFresh(ctx, id)` / `isMeetingProjectionFresh(ctx, id)` / `isAgentProjectionFresh(ctx, id)`
  compare `_meta.lastSequence` against the max sequence in the event log. Returns `false` when
  the projection is missing or has fallen behind new events.

**Authoritative read model** is provided by `read-model-service.ts`:
- `getTaskReadModel(ctx, id)` / `getMeetingReadModel(ctx, id)` / `getAgentReadModel(ctx, id)`
  return the current entity state as `Record<string, unknown>` (or `null` if not found).
- `listTaskReadModels(ctx)` / `listMeetingReadModels(ctx)` / `listAgentReadModels(ctx)`
  return all entities of that type.
- The read mode is controlled by `config.readModel.mode`:
  - `projection`: strict mode — missing/stale/corrupt projections throw `MesaError` (no legacy fallback). Error messages prompt "Run mesa rebuild".
  - `hybrid` (default): compatibility migration mode — returns fresh projection when available; warns and falls back to legacy on missing, stale, or corrupted projections.
  - `legacy`: never reads projections — always returns legacy JSON from `.agentmesa/tasks/` etc.
- The CLI `show` and `list` commands for task, meeting, and agent all use the read-model-service.

Task lifecycle semantics:
- `deleteTask` hard-deletes the task file and emits `task_deleted`.
- `archiveTask` preserves the task file (marks it `archived=true`) and emits `task_archived`.
  Both events produce tombstone projections on rebuild.

Projections are written to the `projections/` directory and carry `_meta` fields (source,
rebuiltAt, lastEventId, lastSequence). Existing services still read from `.agentmesa/tasks/`
etc. — projections are not yet the authoritative read path. Events are a durable audit log,
but not yet the sole source of truth.

**Known limits:** Incremental rebuild (replaying only new events since last build) and
staleness auto-detection on read are not yet implemented. Projections must be rebuilt
explicitly via `rebuildAllProjections` or the `mesa rebuild` CLI command (supports `--json`
for programmatic consumption and `--no-clean` to skip stale projection removal).

The `mesa doctor` command detects stale projections (via `isTaskProjectionFresh` etc.) and
reports them as fixable warnings with a recommendation to run `mesa rebuild`. It does not
auto-rebuild.

The `mesa agent show <id>` subcommand is available alongside the existing `add` and `list`
subcommands.

Event type names are frozen as underscore literals (`task_created`, `task_status_changed`, ...) in the `eventTypeSchema` enum in `packages/protocol/src/schemas.ts`. That enum is the single source of truth for the vocabulary: the `EventType` TypeScript union is inferred from it, and a test in `schemas.test.ts` locks the exact set so any addition or rename is a deliberate, reviewed change. Because the event log is append-only, this naming is permanent once written to disk. The tables below use that frozen vocabulary.

## 1. Event Model

Every state change in AgentMesa is recorded as a **MesaEvent**. Events are the source of truth. They are appended, never mutated, and never deleted.

```ts
interface MesaEvent {
  id: string;          // event_<ulid>
  type: string;        // underscore event type, e.g. "task_created" (see eventTypeSchema)
  streamId: string;    // task or meeting id that owns this stream
  data: Record<string, unknown>;  // event payload
  actor: string;       // agent or user id that caused the event
  timestamp: string;   // ISO 8601, recorded at append time
  version: number;     // schema version of this event (1, 2, ...)
}
```

Key invariants:
- Events are immutable once written. The `.jsonl` file is append-only.
- The schema version enables schema evolution without rewriting history.
- `streamId` partitions events per logical aggregate (one stream per task, one per meeting).
- Every event carries `actor` so the audit trail identifies who performed each action.

The current state of any entity is a **projection** rebuilt by replaying its stream in order. Stored projections are denormalized caches; the events are authoritative.

## 2. Event Types

### Task Events

| Type | Payload | Meaning |
|---|---|---|
| `task_created` | `{ title, createdBy, meetingId?, branch?, context? }` | A new task is created |
| `task_status_changed` | `{ previousStatus, newStatus, reason? }` | Task transitions between status states |
| `task_assigned` | `{ previousAssignee?, newAssignee, reviewer? }` | Agent assignment (or re-assignment) |
| `task_deleted` | `{ reason? }` | A task is removed from the workspace |
| `task_archived` | `{ taskId }` | A task is soft-archived (file preserved, marked archived) |

### Meeting Events

| Type | Payload | Meaning |
|---|---|---|
| `meeting_created` | `{ title, agents[] }` | A new collaboration meeting is opened |
| `meeting_status_changed` | `{ previousStatus, newStatus, reason? }` | Meeting changes status (e.g. closed — further messages blocked) |
| `meeting_task_added` | `{ taskId }` | A task is added to the meeting |
| `meeting_agent_added` | `{ agentId }` | An agent joins the meeting |

### Message Events

| Type | Payload | Meaning |
|---|---|---|
| `message_sent` | `{ taskId?, threadId?, replyTo?, from, to?, type, summary, artifactIds? }` | An agent posts a structured message |

### Artifact Events

| Type | Payload | Meaning |
|---|---|---|
| `artifact_created` | `{ kind, taskId?, meetingId?, createdBy, format?, metadata? }` | A durable artifact is attached to a task or meeting |

### Decision Events

| Type | Payload | Meaning |
|---|---|---|
| `decision_made` | `{ meetingId, taskId?, decidedBy, options[], selectedOption, rationale }` | A formal decision is recorded |

### Agent Events

| Type | Payload | Meaning |
|---|---|---|
| `agent_registered` | `{ name, client, roles[], capabilities }` | An agent registers itself with Mesa |
| `agent_joined` | `{ meetingId }` | An agent joins a meeting |
| `agent_left` | `{ meetingId, reason? }` | An agent leaves a meeting |

### Check Events

| Type | Payload | Meaning |
|---|---|---|
| `check_completed` | `{ checkId, result, output?, artifactId? }` | A CI check, test run, or policy check completes |

### Run Events

| Type | Payload | Meaning |
|---|---|---|
| `run_started` | `{ runId, agentId, taskId?, prompt }` | An agent run is started |
| `run_completed` | `{ runId, exitCode, output?, error? }` | An agent run finishes (success or failure) |

The remaining frozen types `thread_created` and `thread_resolved` track discussion-thread lifecycle within a meeting.

## 3. EventStore Interface

```ts
interface EventStore {
  // Append one or more events to a stream. Fails atomically.
  append(streamId: string, events: MesaEvent[]): void;

  // Return all events for a stream in chronological order.
  getStream(streamId: string): MesaEvent[];

  // Query events across streams with optional filters.
  query(filters: {
    type?: string;
    actor?: string;
    since?: string;       // ISO timestamp
    until?: string;       // ISO timestamp
    meetingId?: string;
  }): MesaEvent[];

  // Future: async iterator for streaming/live tail.
  // stream(streamId: string): AsyncIterable<MesaEvent>;
}
```

`append` writes a newline-delimited JSON object to `.agentmesa/events/<streamId>.jsonl`. It acquires a per-stream file lock before writing. Multiple events in a single `append` call are written as a contiguous block so projection rebuilders see consistent batches.

`query` is implemented by scanning all stream files and filtering in-memory. An optional SQLite index (`state.sqlite`) is planned for future releases to make queries efficient without scanning.

`stream` (future) will expose an async iterable for live-tailing event files via `fs.watch`, enabling Mesa Desk and other tools to react in real time.

## 4. Projections

A **projection** is a denormalized JSON snapshot of an entity's current state, built by replaying its event stream from beginning to end.

### Rebuild

```
events for stream "task_abc123" in order:
  task_created        → create skeleton Task { id, title, status: "todo", ... }
  task_assigned       → set assignedTo = "codex"
  task_status_changed → set status = "in_progress"
  artifact_created    → add artifact id to task.artifactIds
  task_status_changed → set status = "ready_for_review"

→ final Task JSON written to .agentmesa/projections/tasks/task_abc123.json
```

Projections are rebuilt whenever:
- A new event is appended to the stream (incremental update).
- A reader detects the projection is stale (see below).
- A CLI command explicitly requests a rebuild (`mesa rebuild`).

### Staleness Detection

Each projection stores `_meta` metadata recording the state of the event log at build time:

```ts
interface ProjectionMeta {
  source: 'event_rebuild';
  rebuiltAt: string;         // ISO 8601 timestamp
  lastEventId: string;       // ID of the last event replayed
  lastSequence: number;      // sequence number of the last event replayed
  projectionVersion: 1;
}
```

Freshness is checked by comparing `_meta.lastSequence` against the maximum `sequence` in
the entity's event stream. `isTaskProjectionFresh(ctx, id)` (and equivalents for meetings
and agents) returns `false` when the projection is missing or has fallen behind. The
`mesa doctor` command surfaces stale projections as `warn`-level fixable findings.

## 5. File Layout

```
.agentmesa/
  events/
    task_<ulid>.jsonl          # one line per event for this task
    meeting_<ulid>.jsonl        # one line per event for this meeting
  projections/
    tasks/
      task_<ulid>.json          # rebuilt current task state
    meetings/
      meeting_<ulid>.json        # rebuilt current meeting state
  artifacts/                    # durable artifact content files
  state.sqlite                  # optional query index (future)
```

Each `.jsonl` file is newline-delimited JSON -- one `MesaEvent` per line, appended in chronological order. This format is human-readable, line-greppable, and trivially parseable by any tool.

## 6. Event Schema Evolution

Events carry their own `version` field so old events can coexist with new ones without rewriting history.

**Migration strategy:**

```ts
const eventMigrators: Record<number, (event: MesaEvent) => MesaEvent> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

function upcast(event: MesaEvent, targetVersion: number): MesaEvent {
  let current = event;
  while (current.version < targetVersion) {
    const migrator = eventMigrators[current.version];
    if (!migrator) break;
    current = migrator(current);
  }
  return current;
}
```

When a projection rebuilder replays events, it calls `upcast(event, CURRENT_VERSION)` on each event before applying it. This means:
- Old events stored at version 1 are transparently upgraded during replay.
- New events are always appended at `CURRENT_VERSION`.
- No on-disk rewrite of history is ever needed.

The migration registry grows over time. Each migrator is a pure function: `(old: MesaEvent) => MesaEvent`. Migrators must be additive only -- they can add fields or reshape payloads, but never drop information.

## 7. Timeline Reconstruction

A meeting timeline is built by collecting events from all streams that participate in the meeting:

1. Query all events for the meeting's own stream (`meeting_<id>.jsonl`).
2. For each task in the meeting, query that task's stream (`task_<id>.jsonl`).
3. Merge and sort all events chronologically by `timestamp`.

The result is a complete chronological timeline:

```
[09:00] meeting_created         -- Planning session opened
[09:05] task_created            -- "Implement QR login"
[09:05] task_assigned           -- assigned to claude
[09:06] agent_registered        -- codex joins
[09:30] task_status_changed     -- in_progress → ready_for_review
[09:31] message_sent            -- claude → codex: review_request
[09:32] artifact_created        -- implementation summary
[10:00] check_completed         -- CI: tests pass
[10:15] message_sent            -- codex → claude: review_result
[10:20] decision_made           -- approve with minor changes
```

The Mesa Desk visual dashboard renders this timeline as a chronological feed. The CLI can output it with `mesa timeline --meeting <id>`.

## 8. Performance

**Write path: O(1)**
- `append` does one `fs.appendFileSync` call per stream file. A per-stream file lock prevents interleaved writes from concurrent processes.

**Read path (current): O(n)**
- `getStream` reads the entire `.jsonl` file. For typical task/meeting streams (tens to hundreds of events), this is fast enough.
- Projection rebuild does one full stream read, then applies each event in memory.

**Query path (current): O(s * e)**
- `query` scans all stream files. Acceptable for local workloads with dozens of streams. An SQLite index is planned for large workspaces.

**Future: snapshot + replay**

For very long-lived streams (thousands of events), introduce periodic snapshots:

```
.agentmesa/events/task_abc123.jsonl          # full event log
.agentmesa/snapshots/task_abc123_050.json     # projection at event #50
```

Rebuild then reads the latest snapshot (event #50), reads only events 51+, and applies the tail. This keeps rebuild time bounded without sacrificing the append-only event log.
