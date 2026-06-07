# AgentMesa Runtime

Every Core service runs inside the Mesa Runtime. The runtime provides the execution
context, enforces policy, records events, and abstracts storage so services never
depend on raw filesystem access or ambient state.

## MesaRuntimeContext

A single context object is passed as the first argument to every service function.
It bundles everything a service needs to operate:

```ts
interface MesaRuntimeContext {
  rootDir: string;                  // project root (contains .agentmesa/)
  paths: MesaWorkspacePaths;        // derived subdirectory paths
  config: MesaConfig;               // loaded workspace configuration
  actor: MesaActor;                 // who is making this request
  storage: MesaStorageAdapter;      // abstract read/write/list/delete
  eventStore: MesaEventStore;       // append-only event journal
  policy: MesaPolicyEngine;         // permission enforcement
  logger: MesaLogger;               // structured, level-aware logger
}
```

Every field is set once at context creation and never mutated afterward.

## MesaActor

Every request has an actor. The actor identifies who is taking the action so policy
can enforce permissions and events can carry the correct attribution.

```ts
type ActorType = 'user' | 'agent' | 'system' | 'cli' | 'ci';

interface MesaActor {
  type: ActorType;
  id: string;                       // unique within the workspace
  client?: string;                  // e.g. "claude-code", "codex", "cursor"
  capabilities?: MesaAgentCapability;
}
```

- `user` — a human invoking the CLI or Desk dashboard.
- `agent` — an AI agent acting through MCP, a connector, or a runner.
- `system` — an internal automated action (e.g. status auto-transition).
- `cli` — a script or one-off command-line invocation without a full identity.
- `ci` — a CI/CD pipeline step (e.g. GitHub Actions).

`capabilities` is required for agent actors so the policy engine can decide what
the agent is allowed to do. For user and system actors it may be omitted.

## MesaLogger

Lightweight structured logging with four severity levels. Every log entry carries
an actor, a timestamp, and optional structured metadata.

```ts
interface MesaLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}
```

The logger writes to `.agentmesa/logs/runtime.jsonl` by default. Each line is a
JSON object with `{ level, message, timestamp, actor, ...meta }`. The logger is
provided on the context — services never `import` a global logger.

## Service Interface Contract

All services follow a single, consistent calling convention:

### State-changing functions

```ts
// Every mutation receives ctx as the first parameter
createTask(ctx: MesaRuntimeContext, input: CreateTaskInput): MesaTask
updateTaskStatus(ctx: MesaRuntimeContext, taskId: string, status: TaskStatus): MesaTask
attachArtifact(ctx: MesaRuntimeContext, input: CreateArtifactInput): MesaArtifact
appendMessage(ctx: MesaRuntimeContext, input: CreateMessageInput): MesaMessage
```

Before mutating state, the service calls `ctx.policy.assertCanPerform(ctx.actor, action)`.
The policy engine returns or throws; the service never checks permissions inline.

After mutating state, the service appends an event through `ctx.eventStore.append(event)`.
The event store writes to the append-only journal before the projection is updated.

### Read-only functions

```ts
getTask(ctx: MesaRuntimeContext, taskId: string): MesaTask
listTasks(ctx: MesaRuntimeContext): MesaTask[]
```

Read functions MAY accept ctx but MUST NOT require policy checks. This keeps reads
fast and allows the CLI and Desk to query state without an authenticated actor.

## Runtime Lifecycle

### Initialization

```
load config  →  create paths  →  init storage adapter  →  init event store  →  init policy engine
```

1. **load config** — read `.agentmesa/config.json`, validate protocol version.
2. **create paths** — derive `MesaWorkspacePaths` from `rootDir`.
3. **init storage adapter** — create the `MesaStorageAdapter` bound to `paths`.
4. **init event store** — open the append-only journal at `paths.logsDir/events.jsonl`.
5. **init policy engine** — load role capabilities and file-access rules.

A context is returned only after all five steps succeed. If any step fails the
caller receives an error and no partial context exists.

### Shutdown

```
flush events  →  close storage  →  release locks
```

1. **flush events** — ensure all buffered events are written to the journal.
2. **close storage** — close any open file handles or database connections.
3. **release locks** — release every lock held by this process's PID.

Shutdown is idempotent. Calling it on an already-shut-down context is a no-op.

## Context Creation Patterns

Contexts are created through factory functions keyed by actor type. No service
or caller constructs a `MesaRuntimeContext` by hand.

```ts
// CLI or Desk — a human user acting directly
const ctx = createUserContext(rootDir: string): MesaRuntimeContext
//  actor.type = 'user', actor.id = 'user'

// MCP or connector — an AI agent acting through tools
const ctx = createAgentContext(rootDir: string, agentId: string): MesaRuntimeContext
//  actor.type = 'agent', actor.id = agentId, capabilities loaded from registry

// CI pipeline — an automated step (GitHub Actions, etc.)
const ctx = createCiContext(rootDir: string): MesaRuntimeContext
//  actor.type = 'ci', actor.id = 'ci'

// Tests — a disposable context pointing at a temp directory
const ctx = createTestContext(rootDir: string): MesaRuntimeContext
//  actor.type = 'system', actor.id = 'test', policy set to permissive
```

Each factory calls the same initialization sequence internally. They differ only
in how they build the `MesaActor` and whether they load capabilities from the
agent registry.

## Design Rules

1. **ctx is immutable during a single operation.** A service function must not
   reassign ctx fields or close over a previous ctx across operations.

2. **ctx carries no mutable state.** It is a bag of references — the storage
   adapter and event store own state internally, but ctx itself is read-only.

3. **New ctx for each top-level operation.** A CLI command, an MCP tool call,
   or a runner invocation each gets a fresh context. Contexts are not pooled
   or shared across concurrent operations.

4. **No ambient imports.** Services import types from `@agentmesa/runtime` but
   never call `loadConfig(".")` or `ensureDir(...)` directly. All I/O goes
   through `ctx.storage`, `ctx.eventStore`, or `ctx.logger`.

5. **Policy always, events always.** Every mutation path calls policy first and
   appends an event after. There is no back door that writes directly to storage
   without going through the policy engine and event store.

6. **Actors are workspace-scoped.** An `agentId` is unique within one workspace.
   Cross-workspace identity is a connector concern, not a runtime concern.
