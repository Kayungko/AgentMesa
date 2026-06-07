# AgentMesa Event-Sourced State Model

AgentMesa uses an event-sourced architecture to preserve a complete, append-only audit trail of every action across all agents, meetings, and tasks.

## 1. Event Model

Every state change in AgentMesa is recorded as a **MesaEvent**. Events are the source of truth. They are appended, never mutated, and never deleted.

```ts
interface MesaEvent {
  id: string;          // event_<ulid>
  type: string;        // dot-delimited event type, e.g. "task.created"
  streamId: string;    // task or meeting id that owns this stream
  data: Record<string, unknown>;  // event payload
  actor: string;       // agent or user id that caused the event
  timestamp: string;   // ISO 8601, recorded at append time
  version: number;     // schema version of this event (1, 2, ...)
}
```

Key invariants:
- Events are immutable once written. The `.jsonl` file is append-only.
- The `version` field enables schema evolution without rewriting history.
- `streamId` partitions events per logical aggregate (one stream per task, one per meeting).
- Every event carries `actor` so the audit trail identifies who performed each action.

The current state of any entity is a **projection** rebuilt by replaying its stream in order. Stored projections are denormalized caches; the events are authoritative.

## 2. Event Types

### Task Events

| Type | Payload | Meaning |
|---|---|---|
| `task.created` | `{ title, createdBy, meetingId?, branch?, context? }` | A new task is created |
| `task.status_changed` | `{ previousStatus, newStatus, reason? }` | Task transitions between status states |
| `task.assigned` | `{ previousAssignee?, newAssignee, reviewer? }` | Agent assignment (or re-assignment) |

### Meeting Events

| Type | Payload | Meaning |
|---|---|---|
| `meeting.created` | `{ title, agents[] }` | A new collaboration meeting is opened |
| `meeting.closed` | `{ reason? }` | A meeting is closed (further messages blocked) |

### Message Events

| Type | Payload | Meaning |
|---|---|---|
| `message.posted` | `{ taskId?, threadId?, replyTo?, from, to?, type, summary, artifactIds? }` | An agent posts a structured message |

### Artifact Events

| Type | Payload | Meaning |
|---|---|---|
| `artifact.attached` | `{ kind, taskId?, meetingId?, createdBy, format?, metadata? }` | A durable artifact is attached to a task or meeting |

### Decision Events

| Type | Payload | Meaning |
|---|---|---|
| `decision.recorded` | `{ meetingId, taskId?, decidedBy, options[], selectedOption, rationale }` | A formal decision is recorded |

### Agent Events

| Type | Payload | Meaning |
|---|---|---|
| `agent.registered` | `{ name, client, roles[], capabilities }` | An agent registers itself with Mesa |

### Check Events

| Type | Payload | Meaning |
|---|---|---|
| `check.completed` | `{ checkId, result, output?, artifactId? }` | A CI check, test run, or policy check completes |

### Run Events

| Type | Payload | Meaning |
|---|---|---|
| `run.started` | `{ runId, agentId, taskId?, prompt }` | An agent run is started |
| `run.completed` | `{ runId, exitCode, output?, error? }` | An agent run finishes (success or failure) |

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
  task.created       → create skeleton Task { id, title, status: "todo", ... }
  task.assigned      → set assignedTo = "codex"
  task.status_changed → set status = "in_progress"
  artifact.attached  → add artifact id to task.artifactIds
  task.status_changed → set status = "ready_for_review"

→ final Task JSON written to .agentmesa/projections/tasks/task_abc123.json
```

Projections are rebuilt whenever:
- A new event is appended to the stream (incremental update).
- A reader detects the projection is stale (see below).
- A CLI command explicitly requests a rebuild (`mesa rebuild`).

### Staleness Detection

Each projection stores a `lastEventSequence` number matching the count of events in its stream at build time. Before reading a projection, the runtime compares this number to the actual line count of the stream file. A mismatch means the projection is stale and must be rebuilt.

```ts
interface ProjectionMeta {
  entityId: string;
  entityType: string;
  lastEventSequence: number;
  builtAt: string;
}
```

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
[09:00] meeting.created         -- Planning session opened
[09:05] task.created            -- "Implement QR login"
[09:05] task.assigned           -- assigned to claude
[09:06] agent.registered        -- codex joins
[09:30] task.status_changed     -- in_progress → ready_for_review
[09:31] message.posted          -- claude → codex: review_request
[09:32] artifact.attached       -- implementation summary
[10:00] check.completed         -- CI: tests pass
[10:15] message.posted          -- codex → claude: review_result
[10:20] decision.recorded       -- approve with minor changes
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
