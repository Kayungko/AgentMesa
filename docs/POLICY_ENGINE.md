# AgentMesa Policy Engine

AgentMesa operates in a multi-agent environment where different agents with different capabilities need controlled access to shared project state. The policy engine is the gatekeeper that enforces what each actor can do, based on who they are, what role they have, and what they are actually capable of.

## Implementation Status

| Capability | Status |
|---|---|
| **Role-based policy engine** | **Done, and now the default for new workspaces.** `RoleBasedPolicyEngine` in core implements `MesaPolicyEngine` with action→capability mapping for all 23 actions. Roles: owner, admin, builder, reviewer, connector, ci, system, read_only, chair, planner, tester, documenter, maintainer, researcher, custom. `['owner']` bypasses all checks. Constructor accepts per-role capability overrides. `mesa init` (or any first `createRuntimeContext` call against a directory with no `.agentmesa/config.json` yet) now writes `policy.mode: "role-based"` into the new workspace's config; pre-existing workspaces without a `policy` field keep resolving to `AllowAllMesaPolicyEngine`, unaffected. Test fixture `makeRoleBasedContext()` enables policy enforcement tests. |
| **Action/capability completeness** | **Done.** All service actions (task.*, meeting.*, message.append, artifact.create, agent.register, event.read, projection.read, projection.rebuild, transport.inspect, run.*, handoff.*, check.*) are mapped. Unknown actions are denied by default. |
| **Permission checker** | **Done** (policy package). `PermissionChecker` validates `(role, action)` pairs against the role-capability matrix. |
| **File access rules** | **Done** (policy package). `FileAccessChecker` matches glob patterns against allowed/denied roles. Secret path detection built in. |
| **Command safety** | **Done** (policy package). `CommandPolicyChecker` classifies commands as safe/blocked/approval-required. |
| **Secret protection** | **Done** (policy package). `SecretProtection` detects secret content patterns (API keys, tokens, PEM) and sanitizes output. |
| **Audit log** | **Done** (policy package). `AuditLog` writes append-only audit entries to `.agentmesa/logs/audit.jsonl` with query support. |
| **Core integration** | **Done for role/capability checks.** `assertPolicy` calls `ctx.policy.can()` in all state-changing services. Public projection read APIs (`getTaskProjection`, `listTaskProjections`, etc.) enforce `projection.read`; internal `_get*`/`_list*` helpers and freshness helpers (`isTaskProjectionFresh`, etc.) are excluded from `@agentmesa/core` public exports and only used by `read-model-service` and `doctor` internally. New workspaces default to `RoleBasedPolicyEngine`; pre-existing workspaces keep `AllowAllMesaPolicyEngine` unless they opt in. Capability gating (canEditFiles, canRunShell, etc.) is not yet checked by core services — deferred, no concrete driving use case yet. |
| **Context-aware checks** | **Implemented.** `canWithContext(actor, action, resource, context?)` is the primary evaluation method. `RoleBasedPolicyEngine` enforces reviewer status transition gating: pure reviewer may only transition task status to `approved` or `changes_requested`. Multi-role actors with any other `change_status`-capable role (builder, chair, admin, maintainer, owner) bypass the gate. `can()` delegates to `canWithContext()`. |
| **CLI policy commands** | **Done.** `mesa policy check <action> <resource> --actor --role` (default `--mode role-based`) evaluates against the canonical `RoleBasedPolicyEngine`. Missing `action` with `--json` outputs structured error. `mesa policy inspect` (default `--mode role-based`) prints the full role-capability matrix covering all 15 `VALID_ROLES` (owner, admin, builder, reviewer, connector, ci, system, read_only, chair, planner, tester, documenter, maintainer, researcher, custom) and all 23 known actions (including `run.*`/`handoff.*`/`check.*`). `--mode current` uses the workspace's configured policy engine. `--role` validates against known role values (`AgentRole | PermissionLevel`); `--roles a,b` supports comma-separated multi-role. Both commands support `--json` output with `mode` field. |
| **Enforcement tests** | **Done.** Policy tests cover: builder deny delete/archive, connector deny delete/create, ci deny delete/create, reviewer context-aware status gate (pure reviewer only approved/changes_requested; reviewer+builder/chair/admin/maintainer/owner bypass), system deny write tasks, owner/admin bypass, allow-all backward compat, canWithContext pass-through, unknown action deny, event.read/projection.read/rebuild/transport.inspect enforcement, individual rebuild and direct projection read enforcement, read_only allow/deny, builder manage_agents/manage_meetings, all 23 actions and 15 roles. |

The document below describes the full target design. Sections without an implementation row in the table above are design intent.

## Policy Model

Every actionable request is a structured permission check evaluated by the policy engine before execution proceeds:

```
(actor, action, resource, context) => allowed | denied | requires_approval
```

### Actor

Who is acting. Never a bare string. Each actor type carries its own identity semantics:

- **User** — the human chair. Represented as `user:<id>`. Always the highest authority. Can override requires_approval decisions.
- **Agent** — a specific AI agent instance. Represented as `agent:<id>` with an associated `MesaAgentCapability` declaration and one or more assigned roles.
- **System** — the Core runtime itself, performing internal operations like state projection, event compaction, or lock management. Represented as `system:core`.
- **CI** — an automated CI connector (GitHub Actions, etc.). Represented as `ci:<connector_id>`. CI actors have narrower permissions by default.

### Action

What the actor wants to do. Concrete, auditable operations:

| Action | Scope |
|---|---|
| `read_task` | Read a task's full state, messages, and artifacts |
| `write_task` | Create or update task definition, description, acceptance criteria |
| `change_status` | Transition a task to a new status |
| `post_message` | Append a message to a meeting or task thread |
| `create_artifact` | Produce a durable artifact (review, test result, doc, check output) |
| `modify_source` | Write to source files in the workspace |
| `run_command` | Execute a shell command via the runner |
| `push_code` | Push commits to a remote |
| `merge_pr` | Merge a pull request |
| `manage_agents` | Register, configure, or remove agents |
| `manage_meetings` | Create, configure, or close meetings |
| `archive_task` | Soft-archive a task (preserves record, marks inactive) |
| `delete_task` | Hard-delete a task from the filesystem |
| `read_events` | Read event log entries (listEvents, getTaskEvents, getMeetingEvents) |
| `read_projections` | Read task/meeting/agent projections |
| `rebuild_projections` | Rebuild all projections from event stream |
| `inspect_transports` | List available transports and their capabilities |
| `manage_runs` | Create, update, and read agent runs |

### Resource

What the actor wants to act on. Typed and identified for precise rule matching:

- `task:<id>` — a specific task.
- `meeting:<id>` — a specific meeting.
- `file:<glob_pattern>` — a file or set of files matching a pattern.
- `command:<shell_string>` — a shell command the runner is about to execute.
- `artifact:<id>` — a specific artifact.
- `agent:<id>` — a specific agent (for manage_agents actions).

### Context

Additional constraints the decision may depend on:

- `workspace` — the project root path. Commands and file access are scoped to this directory.
- `taskState` — the current status of the task being acted on (e.g., reviewer can only change_status on a task currently in `in_review`).
- `meetingPhase` — whether the meeting is active, paused, or closed.
- `timeWindow` — optional time-based access restrictions.
- `userPresent` — whether the human user is available for approval prompts.

## Evaluation Rules

1. Every check produces exactly one result: `allowed`, `denied`, or `requires_approval`.
2. `denied` takes absolute priority. If any rule denies, the action is denied regardless of other rules that might allow it.
3. Default is `denied` for unknown actors. An actor must be registered in the runtime and assigned at least one role.
4. `requires_approval` means the action is not blocked, but the user must confirm before execution proceeds. If the user is not present, the action is treated as `denied` until the user returns.
5. Policy decisions are deterministic: the same (actor, action, resource, context) at the same point in time always produces the same result.
6. Roles grant permission to attempt; capabilities gate whether the attempt can actually succeed.

## Actor/Action/Resource Model

Every policy check is a triple `(actor, action, resource)` wrapped with `context`. The policy engine resolves this in layers:

```
1. Actor resolution   — who is this? registered? what roles? what capabilities?
2. Role rule matching  — does any assigned role permit this action on this resource?
3. Capability gating   — can this actor's declared capabilities actually execute this?
4. Resource rule match — do file/command/resource-specific rules further constrain this?
5. Context evaluation  — do runtime constraints (state, time, user presence) affect this?
```

The order matters. A denied actor never reaches role matching. A role mismatch never reaches capability gating. The first `denied` result terminates evaluation immediately.

## Role-Based Capability Matrix

Roles are the coarse-grained permission layer. Every actor is assigned one or more roles. The role determines which actions the actor may attempt. The matrices below define the complete permission surface.

### Production Roles (v0.7+)

| Action | owner | admin | builder | reviewer | connector | ci | system | read_only |
|---|---|---|---|---|---|---|---|---|
| `read_task` (task.get) | Y | Y | Y | Y | Y | Y | Y | Y |
| `write_task` (task.create/assign) | Y | Y | Y | — | — | — | — | — |
| `change_status` (task.updateStatus) | Y | Y | Y | Y* | — | — | — | — |
| `post_message` (message.append) | Y | Y | Y | Y | Y | Y | — | — |
| `create_artifact` (artifact.create) | Y | Y | Y | Y | Y | Y | — | — |
| `archive_task` (task.archive) | Y | Y | — | — | — | — | — | — |
| `delete_task` (task.delete) | Y | Y | — | — | — | — | — | — |
| `manage_agents` (agent.register) | Y | Y | Y | — | — | — | — | — |
| `manage_meetings` (meeting.*) | Y | Y | Y | — | — | — | — | — |
| `read_events` (event.read) | Y | Y | Y | Y | Y | Y | Y | Y |
| `read_projections` (projection.read) | Y | Y | Y | Y | Y | Y | Y | Y |
| `rebuild_projections` (projection.rebuild) | Y | Y | — | — | — | — | Y | — |
| `inspect_transports` (transport.inspect) | Y | Y | — | — | — | — | — | — |
| `manage_runs` (run.*, handoff.*, check.*) | Y | Y | Y | Y | — | Y | — | Y |
| `manage_runs` (run.create, run.updateStatus, run.read) | Y | Y | Y | Y | — | Y | — |

`*` Pure reviewer may only transition status to `approved` or `changes_requested`. Multi-role actors with another `change_status`-capable role (builder, chair, admin, maintainer, owner) are not restricted.

### Legacy Roles (backward compat)

| Action | chair | planner | builder | reviewer | tester | documenter | maintainer |
|---|---|---|---|---|---|---|---|
| `read_task` | Y | Y | Y | Y | Y | Y | Y |
| `write_task` | Y | Y | Y | — | — | — | Y |
| `change_status` | Y | — | Y | Y* | — | — | Y |
| `post_message` | Y | Y | Y | Y | Y | Y | Y |
| `create_artifact` | Y | — | Y | Y | Y | Y | Y |
| `archive_task` | Y | — | — | — | — | — | Y |
| `delete_task` | Y | — | — | — | — | — | Y |
| `manage_agents` | Y | — | Y | — | — | — | Y |
| `manage_meetings` | Y | Y | Y | — | — | — | Y |
| `read_events` | Y | Y | Y | Y | Y | Y | Y |
| `read_projections` | Y | Y | Y | Y | Y | Y | Y |
| `rebuild_projections` | Y | — | — | — | — | — | Y |
| `inspect_transports` | Y | — | — | — | — | — | Y |
| `manage_runs` | Y | Y | Y | Y | Y | — | Y |

### Role Definitions

- **owner** — workspace owner. Full authority across all actions and resources. Bypasses all policy checks. Typically the human user.
- **admin** — workspace administrator. Same full authority as owner for management operations.
- **builder** — the primary implementation role. Can read, write, change status, post messages, create artifacts, register agents, and create meetings. Cannot delete or archive tasks. This is also the MCP server's default actor role when `AGENTMESA_MCP_ACTOR_ROLES` is unset.
- **reviewer** — inspects and evaluates work. Reads tasks, posts messages, creates review artifacts, and changes status only to `approved` or `changes_requested`. Cannot modify source code or manage infrastructure.
- **connector** — external system connector (GitHub, Git, Shell). Posts messages, creates artifacts, reads events/projections. Cannot create/delete tasks or manage meetings.
- **ci** — CI/CD automation actor. Posts messages, creates check_result artifacts, reads events/projections, manages runs. Cannot modify tasks or meetings.
- **system** — Core runtime internal actor. Rebuilds projections, reads events/projections. Cannot write tasks, post messages, or create artifacts.
- **read_only** — external read-only viewers (e.g. Mesa Desk's dashboard actor). Reads tasks, events, projections, runs, workflows, checks, and handoffs. Cannot write anything.

### Legacy Role Definitions (backward compat)

- **chair** — full authority across all actions and resources. The only legacy role that can merge PRs and override requires_approval decisions.
- **planner** — defines and organizes work. Reads and writes tasks, posts messages, manages meetings. Cannot touch source code or run commands.
- **builder** — the primary implementation role (matches production builder capabilities above).
- **reviewer** — inspects and evaluates work (matches production reviewer capabilities above).
- **tester** — validates work through automated and manual testing. Reads tasks, posts messages, creates test artifacts, and runs commands. Cannot modify source code.
- **documenter** — produces documentation artifacts. Reads tasks, posts messages, creates documentation artifacts.
- **maintainer** — builder capabilities plus `manage_agents` and `manage_meetings`, archive, delete, rebuild, inspect. Can push code but cannot merge PRs.

## Agent Capability Declaration

Roles grant permission to attempt actions. Capabilities declare what an agent can actually do. Before assigning role-based work, the policy engine checks that the agent's declared capabilities support the required operations.

```ts
MesaAgentCapability {
  supportedTransports:       ('file' | 'mcp' | 'http')[]
  supportedArtifactKinds:    ('review_report' | 'test_result' | 'doc' | 'check_output')[]
  canReviewCode:             boolean
  canEditFiles:              boolean
  canRunShell:               boolean
  canUseMcp:                 boolean
  canOpenPullRequest:        boolean
  canReadPullRequest:        boolean
  maxContextTokens?:          number
}
```

### Capability Gating Rules

| Role action requires | Capability must be true |
|---|---|
| `modify_source` | `canEditFiles` |
| `run_command` | `canRunShell` |
| `create_artifact` of kind `review_report` | `canReviewCode` AND `review_report` in `supportedArtifactKinds` |
| `create_artifact` of kind `test_result` | `test_result` in `supportedArtifactKinds` |
| `push_code` | `canOpenPullRequest` (push is gated by PR capability) |
| Any MCP tool invocation | `canUseMcp` |
| `post_message` via MCP | `canUseMcp` AND `'mcp'` in `supportedTransports` |

Capability checks run after role checks. If a role permits `modify_source` but `canEditFiles` is false, the action is denied at the capability layer with reason `"agent capability mismatch: canEditFiles is false"`.

`maxContextTokens` is advisory. If an agent declares a token limit and a task's context exceeds it, the orchestrator is expected to chunk or summarise rather than fail. The policy engine records a warning but does not deny the action.

## File Access Policy

File access is governed by pattern-based rules with role-scoped enforcement. Each rule is a tuple of `(glob_pattern, action, allowed_roles)`.

### Default Write Rules

| Pattern | Allowed Roles |
|---|---|
| `src/**` | builder, maintainer |
| `lib/**` | builder, maintainer |
| `packages/**` | builder, maintainer |
| `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**` | builder, tester, maintainer |
| `docs/**`, `*.md` | builder, documenter, maintainer |
| `.*rc`, `*.config.*`, `tsconfig*.json` | builder, maintainer |

All roles can read any non-protected file. Read access is denied only for protected paths.

### Protected Paths — Always Denied for Write

```
.env, .env.*, .env.*.*
*.pem, *.key, *.pfx, *.p12
id_rsa, id_rsa.*, id_ed25519, id_ecdsa*
credentials.*, credentials/**
secrets/**
**/secrets/**
```

These paths are never writable by any agent, regardless of role. Only the chair (user) may write them. Attempts to read protected files by non-chair actors are also denied.

### Managed Paths — Core Only

```
.agentmesa/**
```

`.agentmesa/` state files are managed exclusively by Core services. Individual agents read meeting and task state through Core APIs (`read_task`, `list_tasks`, etc.); they never write `.agentmesa/` directly. This prevents agents from corrupting shared meeting state, task projections, event logs, or the audit trail.

## Command Policy

Commands are classified into three tiers before the runner executes them. Classification happens by pattern matching against the full command string.

### Safe Commands — Always Allowed

```
git status, git diff, git log, git stash list, git branch
npm test, npm run build, npm run lint, npm run typecheck
pnpm test, pnpm build, pnpm lint
node --version, node -e "<safe_expr>"
which, type, echo, pwd, ls, cat (non-secret paths)
```

These are read-only or locally-scoped build/test commands with no side effects beyond the workspace. Safe commands do not require the `run_command` action check to pass role-based rules — they are permitted as long as the actor is registered.

### Blocked Commands — Never Allowed

```
rm -rf /, rm -rf ~, sudo, chmod 777, chown -R
:(){ :|:& };:, $(...) with command substitution
git push --force, git push --delete, git reset --hard, git clean -fdx
curl <url> | bash, wget -O - | sh, eval, exec
```

Also blocked: any command targeting paths outside the workspace boundary, any command that reads files matching protected path patterns, and any command that attempts to modify `.agentmesa/` directly.

### Approval Commands — Allowed Only With User Confirmation

```
npm install <pkg>, npm uninstall <pkg>, npm update <pkg>
pnpm add <pkg>, pnpm remove <pkg>
git push, git push -u origin <branch>
git commit (creates a commit)
npm publish, pnpm publish
npx <pkg>, pnpm dlx <pkg>
```

The runner presents the full command string to the user and waits for explicit approval before executing. If the user is not present (headless CI mode), approval commands are treated as denied unless the CI actor has been explicitly granted the required permissions.

## Policy Integration

The policy engine is part of `MesaRuntimeContext`. Every state-changing operation flows through it:

```
ctx.policy.canPerform(actor, action, resource, context)
```

### Integration Points

- **Core services** — Every mutation (`createTask`, `updateTaskStatus`, `appendMessage`, `attachArtifact`, …) calls `assertPolicy()` or `assertPolicyWithContext()` before writing. Read paths (`listEvents`, `getTaskEvents`, `getMeetingEvents`, projection reads via `read-model-service`, `rebuildAllProjections`, transport listing) now also enforce policy. If denied, the service throws a `PolicyDeniedError` with the decision reason.
- **MCP tools** — each MCP tool handler (`mesa_create_task`, `mesa_request_review`, `mesa_update_status`, etc.) checks policy before accessing or mutating state. The MCP transport never bypasses Core.
- **Runner** — before invoking any agent command, the runner checks command policy classification and file access policy against the agent's declared capabilities and assigned roles.
- **Connectors** — external connectors (GitHub, CI) pass their actor identity through the same `ctx.policy.canPerform()` call. A GitHub PR connector acts as `ci:github`, not as the user who triggered the workflow.

All checks are synchronous at the decision point. There is no cached permission result; every call re-evaluates against the current policy state.

## Audit Log

Every policy decision is recorded in an append-only audit log.

**Format (JSONL, one decision per line):**
```json
{"timestamp":"2026-06-07T14:32:01.000Z","actor":"agent:builder_01","action":"modify_source","resource":"file:src/task.ts","decision":"allowed","reason":"builder role permits source modification"}
{"timestamp":"2026-06-07T14:32:05.000Z","actor":"agent:reviewer_01","action":"modify_source","resource":"file:src/task.ts","decision":"denied","reason":"reviewer role does not permit modify_source"}
{"timestamp":"2026-06-07T14:33:00.000Z","actor":"agent:builder_01","action":"run_command","resource":"command:npm install left-pad","decision":"requires_approval","reason":"dependency installation requires user confirmation"}
```

**Storage:** `.agentmesa/logs/audit.jsonl`

**Query dimensions:**
- By actor — all decisions for a specific agent or user.
- By action — all `run_command` decisions across all actors.
- By time range — decisions within a start/end window.
- By decision — all `denied` or all `requires_approval` entries.
- By resource — all decisions affecting a specific file or task.

The audit log is append-only. It is never truncated or modified by any agent. Log rotation and archival are managed by Core. The audit log itself is a protected path — only the system actor may write to it.

## Default Deny Summary

| Layer | Default | Override Path |
|---|---|---|
| Unknown actor | `denied` | Register actor + assign at least one role |
| Known actor, no matching role rule | `denied` | Add the required role or add an explicit allow rule |
| Role match, capability mismatch | `denied` | Agent must declare the required capability |
| Protected file path (secrets, keys) | `denied` | Never overridable by agents; chair only |
| Managed path (.agentmesa/) | `denied` | Never overridable by agents; Core only |
| Blocked command | `denied` | Never overridable |
| Approval-tier command | `requires_approval` | User confirms in UI or API |
| Safe command | `allowed` (if actor registered) | N/A |

The policy engine enforces that an agent cannot escalate its own privileges. Only the chair (user) can modify role assignments, capability declarations, or policy rules. The system actor can modify policy state only during Core initialization — never in response to an agent request.
