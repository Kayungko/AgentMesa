# AgentMesa Domain Model

This document defines every entity in the complete AgentMesa product. It is the canonical reference for implementation, protocol design, and storage decisions.

---

## Entity Catalog

### 1. MesaMeeting

**Purpose:** A collaboration session where agents coordinate around one or more tasks.

**Key fields:**
- `id` — `meeting_<ulid>`
- `title` — human-readable meeting name
- `purpose` — free-text description of what the meeting is about
- `status` — `planning | active | paused | completed | archived`
- `workspaceId` — owning workspace
- `ownerAgentId` — agent that created the meeting (or null if created by a human)
- `createdAt`, `completedAt`

**Relationships:**
- Has many `MesaTask`s (a meeting may scope multiple tasks; a task belongs to exactly one meeting)
- Has many `MesaMessage`s
- Has many `MesaThread`s
- Has many `MesaDecision`s
- Has many `MesaEvent`s (all meeting-scoped events)

**Lifecycle notes:**
Created by an agent or human user. Agents are invited in (explicitly or by connector). The meeting becomes `active` when the first agent joins. It transitions to `completed` when all tasks are resolved and all decisions are recorded, or to `archived` when the user closes it. A meeting is never deleted — it is only archived.

---

### 2. MesaTask

**Purpose:** A unit of work with a defined status lifecycle, assigned to a builder and optionally a reviewer.

**Key fields:**
- `id` — `task_<ulid>`
- `meetingId` — owning meeting
- `title` — short summary
- `description` — full task description
- `status` — lifecycle state (see below)
- `assignedBuilder` — agent responsible for implementation
- `assignedReviewer` — agent responsible for review (optional)
- `priority` — `low | normal | high | critical`
- `kind` — `implement | review | fix | test | document | research | discuss`
- `parentTaskId` — for subtask decomposition (optional)
- `createdAt`, `updatedAt`, `closedAt`

**Status lifecycle:**
```
backlog -> ready -> in_progress -> in_review -> needs_fix -> in_progress (loop)
                                \-> approved -> completed
                                \-> blocked
```
Any state can transition to `cancelled`.

**Relationships:**
- Belongs to exactly one `MesaMeeting`
- May have a parent `MesaTask` (subtask hierarchy)
- References one builder `MesaAgent` and optionally one reviewer `MesaAgent`
- Has many `MesaMessage`s (task-scoped messages)
- Has many `MesaArtifact`s (outputs produced for this task)
- Has many `MesaCheckResult`s
- Has many `MesaAgentRun`s (executions that acted on this task)
- Has many `MesaDecision`s (decisions made about this task)

**Lifecycle notes:**
Created by an agent or human. Status transitions are enforced by the protocol (not ad-hoc strings). Every transition emits a `MesaEvent`. A task can loop between `in_progress` and `needs_fix` multiple times before approval. Once `completed` or `cancelled`, the task is immutable except for archival.

---

### 3. MesaMessage

**Purpose:** A structured, typed exchange between agents within a meeting.

**Key fields:**
- `id` — `msg_<ulid>`
- `meetingId` — owning meeting (required)
- `threadId` — grouping thread (optional; null means top-level meeting message)
- `taskId` — related task (optional; null for meeting-level discussion)
- `replyToMessageId` — parent message in a thread (optional)
- `senderAgentId` — agent that sent the message
- `kind` — message type
- `body` — structured content (markdown or typed payload)
- `createdAt`

**Message kinds:**
`task_assignment | status_update | review_feedback | fix_request | implementation_summary | question | answer | handoff | general`

**Relationships:**
- Belongs to exactly one `MesaMeeting`
- Optionally belongs to one `MesaThread`
- May reference one `MesaTask`
- May reply to one parent `MesaMessage`
- Sent by exactly one `MesaAgent`

**Lifecycle notes:**
Messages are append-only. Once written, a message is never modified or deleted. This preserves the full communication record. Messages that reference a `threadId` form a tree rooted at the thread's first message.

---

### 4. MesaThread

**Purpose:** A named discussion topic that groups related messages within a meeting.

**Key fields:**
- `id` — `thread_<ulid>`
- `meetingId` — owning meeting
- `title` — topic name
- `rootMessageId` — first message that started the thread
- `resolution` — `unresolved | resolved | stale` (default: `unresolved`)
- `createdAt`, `resolvedAt`

**Relationships:**
- Belongs to exactly one `MesaMeeting`
- Has many `MesaMessage`s (all messages with this `threadId`)
- May be linked to one `MesaDecision` (the resolution decision)

**Lifecycle notes:**
A thread is created implicitly when the first message references a new topic, or explicitly by an agent calling `createThread`. A thread is resolved when a `MesaDecision` settles the discussion, or manually marked `resolved`. Stale threads are those with no activity for a configurable period.

---

### 5. MesaArtifact

**Purpose:** A durable, versioned output produced by an agent during a task or meeting.

**Key fields:**
- `id` — `artifact_<ulid>`
- `meetingId` — owning meeting
- `taskId` — related task (optional, for meeting-level artifacts)
- `kind` — artifact type
- `title` — human-readable label
- `content` — structured body (markdown, JSON, or path reference)
- `mimeType` — `text/markdown | application/json | text/x-diff | text/plain | application/vnd.agentmesa.patch+json`
- `producedByAgentId` — agent that created it
- `version` — revision number (starts at 1)
- `parentArtifactId` — previous version (for version chain)
- `tags` — free-form labels for discovery
- `createdAt`

**Artifact kinds:**
`implementation_summary | review_report | fix_summary | test_results | git_diff | patch | decision_record | pr_summary | agent_run_log | custom`

**Relationships:**
- Belongs to exactly one `MesaMeeting`
- May reference one `MesaTask`
- Produced by one `MesaAgent`
- May chain to a previous version via `parentArtifactId`

**Lifecycle notes:**
Artifacts are append-only and immutable. Revisions create new artifact records chained by `parentArtifactId`. Artifacts stored as structured files under `.agentmesa/artifacts/`; the entity record holds metadata and a content pointer or inline content.

---

### 6. MesaDecision

**Purpose:** An explicit, auditable decision record capturing options, selection, and rationale.

**Key fields:**
- `id` — `decision_<ulid>`
- `meetingId` — owning meeting
- `taskId` — related task (optional)
- `threadId` — related thread (optional, if the decision resolved a discussion)
- `decidedBy` — agent or user identity that made the decision
- `title` — short summary of the decision
- `options` — array of considered alternatives
- `selectedOption` — the chosen option
- `rationale` — explanation for the choice
- `createdAt`

**Relationships:**
- Belongs to exactly one `MesaMeeting`
- May reference one `MesaTask`
- May reference one `MesaThread` (resolving that thread)
- Made by one agent or user

**Lifecycle notes:**
Decisions are immutable once recorded. They serve as the formal record of why a direction was chosen. A decision that resolves a `MesaThread` updates the thread's `resolution` to `resolved`.

---

### 7. MesaAgent

**Purpose:** A participant in meetings, representing an AI agent with specific roles and capabilities.

**Key fields:**
- `id` — `agent_<ulid>`
- `name` — display name (e.g. "Claude", "Codex Reviewer")
- `clientId` — which `MesaClient` runtime this agent uses
- `role` — primary role in the current meeting context
- `capabilities` — embedded `MesaAgentCapability` declaration
- `status` — `available | busy | offline`
- `metadata` — arbitrary key-value store for client-specific data

**Roles:** `planner | builder | reviewer | tester | documenter | researcher | chair | custom`

**Relationships:**
- Uses one `MesaClient`
- Has one `MesaAgentCapability` declaration
- Participates in many `MesaMeeting`s
- Is assigned to many `MesaTask`s (as builder or reviewer)
- Sends many `MesaMessage`s
- Produces many `MesaArtifact`s
- Has many `MesaAgentRun`s

**Lifecycle notes:**
An agent is registered when it first connects to a workspace. Its capabilities are declared at registration and can be updated. An agent's `status` reflects whether it is currently executing a run.

---

### 8. MesaAgentCapability

**Purpose:** A declarative record of what a specific agent can and cannot do.

**Key fields:**
- `agentId` — owning agent
- `supportedTransports` — which transport protocols the agent can use (`file | mcp | http | websocket`)
- `supportedArtifactKinds` — which artifact types the agent can produce
- `canReviewCode` — boolean
- `canEditFiles` — boolean
- `canRunShell` — boolean
- `canUseMcp` — boolean
- `canOpenPullRequest` — boolean
- `canReadPullRequest` — boolean
- `canExecuteCommands` — list of allowed command categories
- `maxContextTokens` — maximum context window (optional; for planning task sizes)
- `allowedFilePatterns` — glob patterns for files the agent may access
- `deniedFilePatterns` — glob patterns the agent must not touch

**Relationships:**
- Owned by exactly one `MesaAgent`

**Lifecycle notes:**
Declared when an agent registers. Validated by the policy engine on every operation. Capabilities can be narrowed (never widened without re-registration). This is the input to policy enforcement, not the policy itself.

---

### 9. MesaClient

**Purpose:** Represents the client runtime an agent uses to connect to AgentMesa.

**Key fields:**
- `id` — `client_<ulid>`
- `name` — `claude-code | codex | cursor | gemini-cli | github | ci | custom`
- `transport` — primary transport the client uses (`MesaTransport`)
- `version` — client version string
- `supportedFeatures` — feature flags the client advertises
- `metadata` — client-specific configuration

**Relationships:**
- Used by many `MesaAgent`s
- Connects via one primary `MesaTransport`

**Lifecycle notes:**
A client record is created when an agent first connects from a new client type. It represents the runtime environment, distinct from the agent identity (an agent can switch clients, but capabilities may change).

---

### 10. MesaAgentRun

**Purpose:** A single execution of an agent action, capturing what was done and what happened.

**Key fields:**
- `id` — `run_<ulid>`
- `agentId` — agent that executed
- `meetingId` — meeting context
- `taskId` — task context (optional)
- `action` — what the agent was asked to do (`implement | review | fix | test | document | plan | custom`)
- `status` — `pending | running | completed | failed | cancelled`
- `inputSummary` — brief description of input
- `outputSummary` — brief description of result
- `producedArtifactIds` — artifacts created during this run
- `startedAt`, `completedAt`
- `error` — error details if failed

**Relationships:**
- Executed by one `MesaAgent`
- Scoped to one `MesaMeeting`
- May target one `MesaTask`
- Produces zero or more `MesaArtifact`s
- May produce `MesaCheckResult`s

**Lifecycle notes:**
Created when an agent begins work. Transitions to `running` when execution starts, then to `completed`, `failed`, or `cancelled`. Every run is recorded as an audit event. Runs are the unit of agent accountability.

---

### 11. MesaCheckResult

**Purpose:** The output of a local automated check — tests, linting, type-checking, or custom validations.

**Key fields:**
- `id` — `check_<ulid>`
- `taskId` — related task
- `runId` — agent run that triggered the check (optional)
- `kind` — `test | lint | typecheck | security | custom`
- `status` — `passed | failed | error | skipped`
- `summary` — human-readable result
- `detail` — full output or path to output file
- `createdAt`

**Relationships:**
- Belongs to one `MesaTask`
- May be linked to one `MesaAgentRun`

**Lifecycle notes:**
Produced during `MesaAgentRun` execution or by a CI transport. Append-only. Multiple check results can exist for the same task (e.g., tests + lint). They inform task status transitions (e.g., `needs_fix` if checks fail).

---

### 12. MesaEvent

**Purpose:** An append-only audit record of every meaningful state change in the system.

**Key fields:**
- `id` — `event_<ulid>`
- `meetingId` — owning meeting
- `streamId` — entity this event belongs to (e.g., `task_<ulid>`)
- `streamType` — entity type name (`MesaTask`, `MesaMeeting`, etc.)
- `eventType` — what happened
- `actor` — agent or user identity that caused the event
- `payload` — event-specific data
- `createdAt`

**Event types (representative):**
`task_created | task_status_changed | task_assigned | meeting_created | agent_joined | agent_left | message_sent | artifact_created | decision_made | run_started | run_completed | check_completed | thread_created | thread_resolved`

**Relationships:**
- Scoped to one `MesaMeeting`
- References one entity (via `streamId` + `streamType`)
- Attributed to one actor

**Lifecycle notes:**
Events are the **source of truth** for system state. They are written to `.agentmesa/events/*.jsonl` as append-only JSON lines. Projections (task JSON, meeting JSON, etc.) are derived from the event stream. Events are never modified or deleted.

---

### 13. MesaTransport

**Purpose:** An abstraction over how agents connect to the AgentMesa runtime.

**Key fields:**
- `id` — `transport_<ulid>`
- `kind` — `file | mcp | http | websocket | github | ci`
- `config` — transport-specific configuration
- `status` — `active | inactive | error`

**Transport kinds and their purpose:**
- `file` — agents read/write `.agentmesa/` files directly (lowest-friction, always available)
- `mcp` — agents use MCP tools served by a local Mesa MCP server (preferred for capable agents)
- `http` — local REST API for agents that speak HTTP but not MCP
- `websocket` — real-time event push for connected agents
- `github` — GitHub App/webhook transport for PR review import and CI integration
- `ci` — CI pipeline transport for publishing check results and artifacts

**Relationships:**
- Used by many `MesaClient`s
- Used by many `MesaAgent`s (indirectly, through their client)

**Lifecycle notes:**
Transports are registered at workspace initialization. A workspace always has the `file` transport active. Additional transports are activated by configuration. A transport can be `inactive` if its server is not running.

---

### 14. MesaWorkspace

**Purpose:** A local project workspace that contains all AgentMesa state under `.agentmesa/`.

**Key fields:**
- `id` — `ws_<ulid>`
- `rootPath` — absolute path to the project root
- `name` — workspace name (defaults to project directory name)
- `createdAt`
- `config` — workspace-level configuration (transports, policies, agents)

**Directory layout:**
```
.agentmesa/
  events/         *.jsonl        append-only source of truth
  projections/    *.json         current state derived from events
  artifacts/      *.md, *.json   durable outputs
  indexes/        state.sqlite   optional query index
  locks/          *.lock         per-resource locks
  config.json                   workspace configuration
```

**Relationships:**
- Contains one `MesaRepository`
- Contains all `MesaMeeting`s (scoped to this workspace)
- Contains all `MesaAgent`s registered in this workspace
- Has many active `MesaTransport`s

**Lifecycle notes:**
Created by `agentmesa init` in a project directory. A workspace is local to a single machine (by design — AgentMesa is local-first). Remote collaboration is possible through transport bridges (GitHub, CI), but the primary state lives on the user's machine.

---

### 15. MesaRepository

**Purpose:** Context about the project's code repository that AgentMesa operates within.

**Key fields:**
- `id` — `repo_<ulid>`
- `workspaceId` — owning workspace
- `remoteUrl` — origin URL (optional)
- `defaultBranch` — `main`, `master`, etc.
- `currentBranch` — snapshot at last check
- `provider` — `github | gitlab | bitbucket | none`
- `providerMetadata` — provider-specific data (repo ID, org, etc.)

**Relationships:**
- Owned by one `MesaWorkspace`
- Referenced by `MesaArtifact`s of kind `git_diff`, `patch`, `pr_summary`

**Lifecycle notes:**
Detected automatically on workspace init. Updated when the workspace detects branch changes. Used to correlate AgentMesa state with PRs, commits, and remote CI events.

---

## Relationship Diagram

```
                         ┌──────────────────────┐
                         │    MesaWorkspace      │
                         │  (root container)     │
                         └──────┬───────────────┘
                                │ 1
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
          ┌────────────┐ ┌──────────┐ ┌──────────────┐
          │MesaRepository│ │MesaTransport│ │              │
          └────────────┘ └──────────┘ │              │
                                       │              │
                                ┌──────┘              │
                                │ many                │ many
                                ▼                     ▼
                         ┌──────────┐          ┌───────────┐
                         │MesaClient│          │MesaMeeting │
                         └────┬─────┘          └─────┬─────┘
                              │                      │
                              │ 1                    │ 1
                              ▼                      │
                         ┌───────────┐               │
                         │ MesaAgent │◄──────────────┘
                         │           │   many
                         └─────┬─────┘
                               │
                    ┌──────────┼────────────────────────────┐
                    │          │                            │
                    │ 1        │ many                       │ many
                    ▼          ▼                            ▼
          ┌────────────────┐  ┌──────────────┐    ┌──────────────┐
          │MesaAgentCapability│ │MesaAgentRun  │    │ MesaMessage  │
          └────────────────┘  └──────┬───────┘    └──────┬───────┘
                                     │                    │
                                     │ produces           │ belongs to
                                     ▼                    │
                              ┌──────────────┐            │
                              │ MesaArtifact │            │
                              └──────────────┘            │
                                                          │
┌─────────────────────────────────────────────────────────┘
│
│              ┌──────────────────────────────────────┐
│              │            MesaMeeting                │
│              └──────────────────────────────────────┘
│                │         │         │          │
│                │ 1       │ 1       │ 1        │ 1
│                ▼         ▼         ▼          ▼
│         ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
│         │MesaThread│ │MesaTask│ │MesaDecision│ │MesaEvent │
│         └────┬────┘ └───┬────┘ └──────────┘ └──────────┘
│              │           │
│              │           │ has many
│              │           ▼
│              │    ┌──────────────┐
│              │    │MesaCheckResult│
│              │    └──────────────┘
│              │
│              │ has many
│              ▼
│         ┌───────────┐
│         │MesaMessage │  (threaded)
│         └───────────┘
│
│  ┌───────────────────────────────────────────────┐
│  │ Key:  ───  = has many / contains              │
│  │        ...> = references (foreign key)         │
│  │        1/many = cardinality from parent side   │
│  └───────────────────────────────────────────────┘
```

### Simplified Entity-Relationship Summary

```
MesaWorkspace 1──N MesaTransport
MesaWorkspace 1──1 MesaRepository
MesaWorkspace 1──N MesaMeeting
MesaWorkspace 1──N MesaAgent

MesaClient    1──N MesaAgent
MesaAgent     1──1 MesaAgentCapability
MesaAgent     1──N MesaAgentRun
MesaAgent     1──N MesaMessage (as sender)
MesaAgent     1──N MesaArtifact (as producer)
MesaAgent     N──M MesaTask     (as builder or reviewer)

MesaMeeting   1──N MesaTask
MesaMeeting   1──N MesaMessage
MesaMeeting   1──N MesaThread
MesaMeeting   1──N MesaDecision
MesaMeeting   1──N MesaEvent
MesaMeeting   1──N MesaArtifact
MesaMeeting   1──N MesaAgentRun

MesaThread    1──N MesaMessage
MesaTask      1──N MesaMessage        (task-scoped)
MesaTask      1──N MesaArtifact
MesaTask      1──N MesaCheckResult
MesaTask      1──N MesaAgentRun
MesaTask      1──N MesaDecision

MesaMessage   1──N MesaMessage        (reply chain)
MesaAgentRun  1──N MesaArtifact
MesaAgentRun  1──N MesaCheckResult

MesaEvent     references any entity   (streamId + streamType)
```

---

## Core Invariants

These must hold true at all times. The protocol and storage layer enforce them.

| # | Invariant |
|---|-----------|
| 1 | Every `MesaMessage` belongs to exactly one `MesaMeeting`. |
| 2 | Every `MesaTask` belongs to exactly one `MesaMeeting`. |
| 3 | Every `MesaThread` belongs to exactly one `MesaMeeting`. |
| 4 | Every `MesaDecision` belongs to exactly one `MesaMeeting`. |
| 5 | Every `MesaArtifact` belongs to exactly one `MesaMeeting`. |
| 6 | Every `MesaEvent` is scoped to exactly one `MesaMeeting`. |
| 7 | A `MesaTask` can only transition through allowed status edges (no arbitrary jumps). |
| 8 | A `MesaMessage` is immutable after creation (append-only). |
| 9 | A `MesaArtifact` is immutable after creation; revisions create new artifact records. |
| 10 | A `MesaDecision` is immutable after creation. |
| 11 | A `MesaEvent` is never modified or deleted (append-only source of truth). |
| 12 | An agent cannot perform an action outside its declared `MesaAgentCapability`. |
| 13 | An agent cannot mutate state without a valid `MesaRuntimeContext` that includes actor identity and policy evaluation. |
| 14 | Two agents cannot simultaneously write to the same logical resource (lock enforced). |
| 15 | All entity IDs use the format `<prefix>_<ulid>` where prefix is the entity's short name. |

---

## Source of Truth vs Projection

AgentMesa uses an event-sourced architecture. This distinction is fundamental.

### Source of Truth Entities

These are the canonical, append-only records. The event stream is the ultimate authority.

| Entity | Storage | Mutability |
|--------|---------|------------|
| `MesaEvent` | `.agentmesa/events/*.jsonl` | Append-only, never modified |
| `MesaMessage` | `.agentmesa/events/*.jsonl` (as event payload) | Append-only, never modified |
| `MesaDecision` | `.agentmesa/events/*.jsonl` (as event payload) | Append-only, never modified |

### Projection Entities

These are derived from the event stream. They represent the current state at a point in time and can be rebuilt from events.

| Entity | Storage | Rebuild from |
|--------|---------|-------------|
| `MesaMeeting` | `.agentmesa/projections/meetings/<id>.json` | Events where `streamId` matches |
| `MesaTask` | `.agentmesa/projections/tasks/<id>.json` | Events where `streamId` matches |
| `MesaThread` | `.agentmesa/projections/threads/<id>.json` | Events where `streamId` matches |
| `MesaAgent` | `.agentmesa/projections/agents/<id>.json` | Events where `streamId` matches |
| `MesaAgentRun` | `.agentmesa/projections/runs/<id>.json` | Events where `streamId` matches |

### Hybrid Entities

These entities are written as durable files (artifacts) plus have projection metadata.

| Entity | Durable Storage | Projection Metadata |
|--------|----------------|---------------------|
| `MesaArtifact` | `.agentmesa/artifacts/<id>.<ext>` | `.agentmesa/projections/artifacts/<id>.json` |

### Configuration Entities

These are not event-sourced; they are direct configuration files.

| Entity | Storage |
|--------|---------|
| `MesaWorkspace` | `.agentmesa/config.json` |
| `MesaRepository` | `.agentmesa/config.json` (as workspace section) |
| `MesaTransport` | `.agentmesa/config.json` (as transports section) |
| `MesaClient` | `.agentmesa/config.json` (as clients section) |
| `MesaAgentCapability` | Declared by agent at registration, stored in agent projection |

### Rebuild Principle

Given the complete event log, all projections can be rebuilt deterministically. This means:
- Projections are caches, not authorities.
- Corrupted projections are repaired by replaying events.
- Schema migrations are applied during replay, not to stored projections.
- The optional SQLite index (`.agentmesa/indexes/state.sqlite`) is also a rebuildable cache.

---

## ID Conventions

All entity IDs follow the pattern `<prefix>_<ulid>`:

| Prefix | Entity |
|--------|--------|
| `meeting_` | MesaMeeting |
| `task_` | MesaTask |
| `msg_` | MesaMessage |
| `thread_` | MesaThread |
| `artifact_` | MesaArtifact |
| `decision_` | MesaDecision |
| `agent_` | MesaAgent |
| `client_` | MesaClient |
| `run_` | MesaAgentRun |
| `check_` | MesaCheckResult |
| `event_` | MesaEvent |
| `transport_` | MesaTransport |
| `ws_` | MesaWorkspace |
| `repo_` | MesaRepository |

ULIDs are used because they are lexicographically sortable (time-ordered), URL-safe, and collision-resistant without coordination — critical for a multi-agent local-first system where agents may generate IDs independently.

---

## Runtime Context

Every mutation operation requires a `MesaRuntimeContext` that bundles:

```
MesaRuntimeContext {
  actor:        AgentIdentity | UserIdentity
  workspace:    MesaWorkspace
  config:       RuntimeConfig
  policy:       PolicyEngine
  storage:      StorageAdapter
  events:       EventStore
  locks:        LockManager
  logger:       Logger
}
```

No service function may mutate state without receiving a context. This ensures every write is attributed, authorized, and auditable.
