# AgentMesa Runtime Context

AgentMesa Core 的所有入口最终都应通过统一 Runtime Context 执行。CLI、MCP、
File Protocol、插件、GitHub 和 CI 只负责构造 actor 与适配输入，不应各自初始化
一套 Core 依赖。

## Runtime Context

```ts
interface MesaRuntimeContext {
  readonly rootDir: string;
  readonly paths: MesaWorkspacePaths;
  readonly config: MesaConfig;
  readonly actor: MesaActor;
  readonly storage: MesaStorageAdapter;
  readonly eventStore: MesaEventStore;
  readonly policy: MesaPolicyEngine;
  readonly logger: MesaLogger;
}
```

Context 在一次顶层操作中保持只读。服务不得从全局状态推断当前 actor，也不得绕过
context 中的 storage、eventStore、policy 或 logger 建立新的运行时依赖。

## Actor

```ts
interface MesaActor {
  id: string;
  type: 'user' | 'agent' | 'system' | 'cli' | 'ci';
  roles: Array<AgentRole | PermissionLevel>;
  client?: string;
}
```

`ctx.actor` 是 mutation 的权威身份。输入中的 `createdBy`、`updatedBy` 等兼容字段
不能覆盖当前 actor，避免 transport 调用方伪造审计身份。

## Runtime Dependencies

### Storage

`MesaStorageAdapter` 当前提供：

- `readText`
- `writeText`
- `exists`
- `list`
- `delete`

默认实现是 `FileStorageAdapter`。当前写入仍是普通文件写入；atomic write、锁感知
写入和并发冲突处理留给 Storage Hardening 阶段。

### Event Store

`MesaEventStore` 提供稳定的 `append(event)` 与 `list(filter?)` 接口。当前默认实现
`InMemoryMesaEventStore` 仅在单个 context 生命周期内保存事件，用于锁定接口和验证
actor 归因。

它不是持久事件源，也不代表 Event-backed State 已完成。后续阶段将替换为 append-only
事件日志，并支持 projection 重建。

### Policy

`MesaPolicyEngine.can(actor, action, resource)` 返回 `MesaPolicyDecision`。新建的
工作区默认使用 `RoleBasedPolicyEngine`（`mesa init` 会把 `policy.mode: "role-based"`
写进 config.json）；已存在且没有 `policy` 字段的旧工作区仍解析为
`AllowAllMesaPolicyEngine`，不受影响。已迁移 service 的 mutation 均在写入前
统一调用 policy，替换实现无需改变 service 签名。

### Logger

`MesaLogger` 提供 `debug`、`info`、`warn`、`error`。当前默认实现写入 console，并附带
actor 与 timestamp。结构化文件日志留待日志和存储层进一步加固。

## Context Creation

```ts
const ctx = createRuntimeContext({
  rootDir: process.cwd(),
  actor: {
    id: 'user:local',
    type: 'user',
    roles: ['owner'],
  },
});
```

`createRuntimeContext` 会：

1. 规范化 root directory 并生成 workspace paths。
2. 创建 `.agentmesa` 基础目录。
3. 加载现有 config，或创建最小 config。
4. 注入默认 storage、event store、policy 与 logger。
5. 接受依赖覆盖，支持测试和未来 transport adapter。

API 当前保持同步；调用方使用 `await createRuntimeContext(...)` 仍可正常工作。

## Current Migration Status

已迁移到 `MesaRuntimeContext`：

- `createTask`
- `getTask`
- `listTasks`
- `updateTaskStatus`
- `assignTask`
- `deleteTask`
- `createMeeting`
- `getMeeting`
- `listMeetings`
- `updateMeetingStatus`
- `addTaskToMeeting`
- `addAgentToMeeting`
- `appendMessage`
- `getMessage`
- `listMessages`
- `getMessagesByTask`
- `createArtifact`
- `getArtifact`
- `listArtifacts`
- `registerAgent`
- `getAgent`
- `listAgents`
- CLI task、meeting、message、artifact、agent commands
- MCP task、message、review、artifact、meeting、agent handlers
- Desk task、meeting、message、artifact、agent queries
- Git/Shell/GitHub connectors 中创建 artifact 的必要适配

尚未迁移：

- lock manager
- Runner 和 Orchestrator 的完整 runtime 生命周期

lock manager 暂时保留 `paths` 签名，因为它直接体现当前文件锁实现。该部分会与
atomic write、lock-aware write 一起进入 Storage Hardening，避免把运行时上下文迁移
和并发写入语义混在同一阶段。

`deleteTask` 已迁移到 ctx storage 和 policy，并追加内存 `task_deleted` 事件。meeting
状态变更、meeting 任务成员变更、meeting agent 成员变更和 agent 注册也有独立事件类型。
这些事件只进入当前 context 的非持久 EventStore，不代表 Event-backed State 已开始。

Agent registry 使用编码后的文件名保存 agent id，避免 `agent:codex`、`user:local`
这类跨客户端身份在 Windows 文件系统中被 `:` 解释为 alternate stream。

## Next Steps

1. 继续检查非 Core service 生命周期中是否还存在可收口的 runtime 入口。
2. Runtime Context 验收面完成后，优先补 meeting/message/artifact/agent 的更细行为测试。
3. 再进入 Event-backed State；atomic write、lock-aware write 与持久 event store 留给后续阶段。
