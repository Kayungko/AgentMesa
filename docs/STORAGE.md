# AgentMesa Storage Layer

AgentMesa's storage layer is the local-first persistence backbone for cross-client AI agent collaboration. It guarantees atomic writes, file-based locking, and event-sourced state so that multiple agent clients can safely share one workspace.

## Implementation Status

This document describes the target design. The sections below track what is actually shipped today versus what is still planned.

| Capability | Status |
|---|---|
| **Atomic writes** (temp + fsync + rename) | **Done.** `FileStorageAdapter.writeText` writes to a `.mesa-tmp-<pid>-<n>` file, fsyncs, then renames into place. A crash mid-write leaves an orphaned temp file rather than a corrupt target; `list()` hides temp files so a partial write is never read as a record. |
| **Atomic lock creation** | **Done.** `acquireLock` uses the `wx` open flag so lock-file creation is atomic — no check-then-write race. Lock filenames are sha256 hashes of the resource id, keeping them filesystem-safe and traversal-proof; the original resource is stored in the lock body. |
| **Orphaned temp-file cleanup** | **Done.** `mesa doctor` reports orphaned `.mesa-tmp-` files; `mesa doctor --fix` removes them. The default run never mutates files. |
| **Persistent event store** | **Not yet.** The current `EventStore` is in-memory only — events do not survive process exit. A file-backed `FileEventStore` (append-only `.jsonl` per stream) is the next phase. Until then, the `events/` and `projections/` layout below is design intent, not on-disk reality. |
| **SQLite index, soft-delete, migration** | **Not yet.** Design intent only. |

The `MesaStorageAdapter` interface, directory layout, and lock-naming description further down reflect the target design and may not match the current code exactly (e.g. the shipped adapter exposes `readText`/`writeText`/`list`, and lock filenames are hashed, not separator-substituted).

## Directory Layout

All workspace data lives under `.agentmesa/` at the project root:

```
.agentmesa/
  events/<streamId>.jsonl            append-only event streams (source of truth)
  projections/tasks/<id>.json         rebuilt current-state views
  projections/meetings/<id>.json
  projections/agents/<id>.json
  artifacts/<id>.json                 durable, immutable outputs
  config.json                         workspace config and storage format version
  logs/                               runtime logs
  locks/                              per-resource lock files
  indexes/state.sqlite                optional query index
  .deleted/                           soft-deleted files
```

- **events/** — Append-only JSONL files, one per event stream. This is the durable source of truth. Projections are rebuilt from these.
- **projections/** — Materialised current state (tasks, meetings, agents). Writable but rebuildable from events at any time.
- **artifacts/** — Immutable durable outputs (review reports, diffs, test results). Written once, never modified after creation.
- **indexes/state.sqlite** — Optional SQLite database for faster ad-hoc queries and dashboard support. Not required for core operation.
- **.deleted/** — Soft-delete staging. Files moved here instead of being permanently erased.

## MesaStorageAdapter Interface

```ts
interface MesaStorageAdapter {
  readJson<T>(path: string): T | null;
  writeJson<T>(path: string, data: T): Promise<void>;
  listJson<T>(dirPath: string): T[];
  deleteFile(path: string): boolean;
  atomicWrite<T>(path: string, data: T): void;
  exists(path: string): boolean;
  ensureDir(dirPath: string): void;
}
```

- **readJson** — Reads and parses a JSON file. Returns `null` when the file does not exist or cannot be parsed.
- **writeJson** — Persists data atomically: writes to a temp file, then renames into place. All writes acquire the resource lock first.
- **listJson** — Reads and parses every JSON file in a directory. Skips unparseable files and logs a warning.
- **deleteFile** — Soft-deletes by moving the file into `.agentmesa/.deleted/`. Returns `false` if the file does not exist.
- **atomicWrite** — Synchronous variant of writeJson that follows the same temp-then-rename contract.
- **ensureDir** — Creates a directory tree if it does not exist (idempotent).

## Atomic Write Strategy

Every write follows a three-step sequence to prevent partial files from corrupting state:

1. **Write temp file** — Serialize data to `<target-path>.tmp.<pid>`, where `<pid>` is the current OS process ID.
2. **Flush/sync** — `fsync` the temp file to disk.
3. **Rename** — Atomically rename the temp file over the target. On the same filesystem, rename is a metadata-only operation and cannot produce partial writes.

On process crash or kill, stale `.tmp.<pid>` files may remain. The workspace doctor (see Diagnostics) removes any temp file whose PID is no longer alive during initialisation.

## Locking Semantics

File-based locks prevent concurrent writes to the same logical resource across processes.

- **Lock directory** — All lock files live in `.agentmesa/locks/`.
- **Per-resource locks** — The lock file path is derived from the resource path: replacing path separators with underscores yields `<resource-token>.lock`. A `tasks/task_01JQ5A7B3N.lock` protects writes to `projections/tasks/task_01JQ5A7B3N.json`.
- **Lock file content** — `{ pid: number, timestamp: string, resource: string }`. The timestamp records when the lock was acquired.
- **Acquisition** — Before any write, `acquireLock(resourcePath)` checks for an existing lock. If none exists, it creates one. If a lock exists, it checks whether the owning PID is still alive. If the PID is dead, the lock is stale and the caller claims it. If the PID is alive, the caller waits and retries briefly, then throws a lock-contention error.
- **Release** — `releaseLock(resourcePath)` deletes the lock file. This is best-effort: a crash may leave the lock behind, but stale detection handles it on the next acquisition attempt.
- **Read path** — Reads never acquire locks. A read may see a slightly stale projection, which is acceptable because projections are rebuildable from the immutable event log.

## Event-Sourced State Model

AgentMesa uses event sourcing to maintain a complete audit trail:

- **Event streams** are append-only JSONL files under `events/`.
- **Projections** are the current-state views rebuilt by replaying events in order. They live under `projections/`.
- **Artifacts** are immutable side-effect outputs written once and never modified.

When a projection is missing or drifted (its version is behind the event stream), the system rebuilds it by replaying all events for that stream. This means projections can be deleted at any time and reconstructed.

## Migration

The storage format version is recorded in `.agentmesa/config.json`:

```json
{
  "storageVersion": 1,
  "workspaceName": "...",
  "createdAt": "..."
}
```

- **Readers** support the current version and all prior versions. When reading old-format data, the reader normalises it into the current shape in memory.
- **Writers** always produce the current format version.
- **Version bump** — When a new AgentMesa version increments the storage version, the next write to any file triggers an on-demand migration of that file (or the entire workspace if preferred). Migrations are idempotent and safe to re-run.

## Multi-Client Safety

- Lock before every write.
- Reads do not require locks.
- Clients must not hold locks for extended periods (no long-lived transactions).
- Stale-lock detection uses PID liveness checks so that a crashed client never permanently blocks others.

## Diagnostics (Workspace Doctor)

The `workspace doctor` command inspects `.agentmesa/` and reports:

| Check | What it finds |
|---|---|
| **Orphaned locks** | Lock files whose PID is no longer running. These are safe to delete. |
| **Stale temp files** | `.tmp.<pid>` files from crashed processes. The doctor removes them if the PID is dead. |
| **Invalid JSON** | Files that fail to parse. Listed with their path and parse error. |
| **Missing projections** | Projections that have an event stream but no current-state file. Can be rebuilt with `workspace rebuild`. |
| **Duplicate IDs** | Two files claiming the same entity ID (e.g., two task files with the same `id` field). |
| **Drifted projections** | Projections whose event-version is lower than the event stream length. Rebuild is suggested. |

The doctor never mutates data automatically. It reports findings and suggests commands (e.g., `workspace rebuild --dry-run`, `workspace clean-locks`).
