# AgentMesa Runtime Context

This document explains what `Runtime Context` means in AgentMesa.

It is written for local AI agents that are implementing the complete AgentMesa product.

## Why This Exists

AgentMesa is a cross-client meeting layer for AI coding agents. The same core operation may be triggered by different entry points:

- CLI user command.
- Claude Code plugin.
- Codex skill.
- MCP tool call.
- File protocol worker.
- GitHub integration.
- CI integration.
- Future desktop monitor action.

These entry points must not each initialize Core in their own incompatible way.

`Runtime Context` is the shared execution object passed into Core services so every operation knows:

- Which workspace it is operating on.
- Who is performing the action.
- Which configuration is active.
- Which storage adapter should be used.
- Where events should be recorded.
- Which policy rules apply.
- How logs should be written.

## Short Definition

Runtime Context is the per-operation execution environment for AgentMesa Core.

It should replace direct service calls like:

```ts
createTask(paths, input)
updateTaskStatus(paths, taskId, status)
appendMessage(paths, input)
```

with calls like:

```ts
createTask(ctx, input)
updateTaskStatus(ctx, taskId, status)
appendMessage(ctx, input)
```

## Target Interface

```ts
export interface MesaRuntimeContext {
  rootDir: string;
  paths: MesaWorkspacePaths;
  config: MesaConfig;
  actor: MesaActor;
  storage: MesaStorageAdapter;
  eventStore: MesaEventStore;
  policy: MesaPolicyEngine;
  logger: MesaLogger;
}
```

The first implementation can use simple minimal versions of these dependencies. The important part is that the boundary is stable.

## Required Sub-Models

### MesaActor

Represents who is performing the operation.

```ts
export interface MesaActor {
  id: string;
  type: 'user' | 'agent' | 'connector' | 'orchestrator' | 'system';
  name?: string;
  client?: string;
  roles: string[];
}
```

Examples:

```txt
user:kayung
agent:claude-code
agent:codex
connector:github
connector:ci
system:agentmesa
```

### MesaConfig

Represents loaded workspace configuration.

```ts
export interface MesaConfig {
  workspaceId: string;
  protocolVersion: string;
  defaultTransport: string;
  createdAt?: string;
  updatedAt?: string;
}
```

### MesaStorageAdapter

Represents the storage implementation used by Core.

The first adapter can be file-based. Future adapters may include indexed or database-backed storage.

```ts
export interface MesaStorageAdapter {
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
}
```

### MesaEventStore

Records durable events for later timeline reconstruction.

```ts
export interface MesaEventStore {
  append(event: MesaEvent): Promise<void>;
  list(filter?: MesaEventFilter): Promise<MesaEvent[]>;
}
```

### MesaPolicyEngine

Central place for deciding whether an actor can perform an action.

```ts
export interface MesaPolicyEngine {
  can(actor: MesaActor, action: string, resource: unknown): Promise<MesaPolicyDecision>;
}
```

### MesaLogger

Shared logging interface for CLI, MCP, runners, and connectors.

```ts
export interface MesaLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
```

## Why paths-only services are not enough

A paths-only service knows only where files live.

It does not know:

- Who is making the change.
- Whether the actor is allowed to make the change.
- Which transport triggered the operation.
- Whether an event must be recorded.
- How to write safely.
- How to log diagnostics.
- How future MCP and CLI calls should behave consistently.

For a complete AgentMesa product, every state-changing service must know this context.

## Migration Target

Current style:

```ts
const paths = createWorkspacePaths(process.cwd());
const task = createTask(paths, input);
```

Target style:

```ts
const ctx = await createRuntimeContext({
  rootDir: process.cwd(),
  actor: {
    id: 'user:local',
    type: 'user',
    roles: ['owner'],
  },
});

const task = await createTask(ctx, input);
```

## Core Services That Should Use Runtime Context

All state-changing services should move to `ctx`:

```txt
createTask
updateTaskStatus
archiveTask
createMeeting
appendMessage
createArtifact
registerAgent
recordDecision
requestReview
submitReview
recordCheckResult
```

Read-only services can also use `ctx` so they share config, storage, and diagnostics.

## Implementation Steps for Local AI

1. Create `packages/core/src/runtime/types.ts`.
2. Define `MesaRuntimeContext`, `MesaActor`, `MesaConfig`, `MesaStorageAdapter`, `MesaEventStore`, `MesaPolicyEngine`, and `MesaLogger`.
3. Create `packages/core/src/runtime/create-runtime-context.ts`.
4. Provide minimal file storage adapter.
5. Provide minimal event store stub that can append events later.
6. Provide permissive policy stub for now, but keep the interface.
7. Provide console logger implementation.
8. Update task service to accept `ctx` instead of `paths`.
9. Update CLI to call `createRuntimeContext()` before calling Core services.
10. Update exports in `packages/core/src/index.ts`.
11. Add tests for creating a runtime context and creating a task through it.

## Acceptance Criteria

Runtime Context work is complete when:

- `MesaRuntimeContext` exists.
- CLI can create a runtime context for a local user.
- Task service uses `ctx`, not only raw paths.
- Actor identity is available during task creation and status changes.
- Storage access goes through `ctx.storage` for migrated services.
- Event store and policy engine interfaces are present, even if their first implementation is minimal.
- Tests or fixtures demonstrate the new service call path.

## What Not To Do Yet

Do not expand MCP, Runner, Claude plugin, Codex plugin, or Desktop features as part of this task.

This task is only about creating the shared runtime boundary that those future integrations will use.
