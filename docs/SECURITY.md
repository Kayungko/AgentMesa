# AgentMesa Security Model

AgentMesa is local-first and permission-aware by default. The policy engine enforces actor-role boundaries for all state-changing operations.

## Principles

1. **Least privilege for every agent** — actors can only perform actions their roles grant.
2. **Explicit deny for unknown actions** — unmapped actions are blocked by default.
3. **No silent access to secrets** — protected paths are never writable by agents.
4. **No automatic merge or push in the default configuration** — approval-tier commands require user confirmation.
5. **Every action is auditable** — policy decisions are logged to `.agentmesa/logs/audit.jsonl`.
6. **Owner bypass** — `owner` role bypasses all checks; this is the human user's role.

## Policy Enforcement Status (v0.7+)

| Layer | Status |
|---|---|
| Role-based policy engine | **Enforced in tests.** `RoleBasedPolicyEngine` maps 16 actions → 13 capabilities with per-role sets. Production roles: owner, admin, builder, reviewer, connector, ci, system. |
| Default mode | `AllowAllMesaPolicyEngine` — no restrictions for local development. |
| Production mode | Set `policy.mode: "role-based"` in `.agentmesa/config.json` to enable enforcement. |
| Context-aware policy | **Enforced.** `canWithContext()` evaluates reviewer status gates — reviewer may only transition to `approved` or `changes_requested`. `updateTaskStatus` now passes `targetStatus` via `assertPolicyWithContext()`. |
| Capability gating | `canEditFiles`, `canRunShell`, etc. not yet checked by core services (deferred). |

## Role-Based Access Matrix

| Action | owner | admin | builder | reviewer | connector | ci | system |
|---|---|---|---|---|---|---|---|
| task.create / task.assign | Y | Y | Y | — | — | — | — |
| task.updateStatus | Y | Y | Y | Y* | — | — | — |
| task.archive | Y | Y | — | — | — | — | — |
| task.delete | Y | Y | — | — | — | — | — |
| meeting.create / updateStatus / addTask / addAgent | Y | Y | — | — | — | — | — |
| message.append | Y | Y | Y | Y | Y | Y | — |
| artifact.create | Y | Y | Y | Y | Y | Y | — |
| agent.register | Y | Y | — | — | — | — | — |
| event.read | Y | Y | Y | Y | Y | Y | Y |
| projection.read | Y | Y | Y | Y | Y | Y | Y |
| projection.rebuild | Y | Y | — | — | — | — | Y |
| transport.inspect | Y | Y | — | — | — | — | — |

`*` reviewer may only transition status to `approved` or `changes_requested`.

## Key Security Boundaries

- **Connector** (e.g., GitHub webhook, Git hook) — can post messages and create artifacts, but cannot create/delete tasks or manage meetings. This prevents external triggers from corrupting project state.
- **CI** (e.g., GitHub Actions) — can post messages and create `check_result` artifacts, but cannot modify tasks or meetings.
- **Builder** — can create and modify tasks but cannot delete or archive them. Hard-delete is a privileged operation.
- **System** — can rebuild projections and read events but cannot write tasks, post messages, or create artifacts. Internal-only role.

## Permission Levels

```txt
owner
  Full authority. Bypasses all policy checks.

admin
  Same full authority as owner for management operations.

builder
  Can read/write tasks, change status, post messages, create artifacts.
  Cannot delete or archive tasks.

reviewer
  Can read tasks, post messages, create review artifacts.
  Can only change status to approved or changes_requested.
  Cannot create or delete tasks.

connector
  Can post messages, create artifacts, read events/projections.
  Cannot create/delete tasks or manage meetings.

ci
  Can post messages, create check_result artifacts, read events/projections.
  Cannot modify tasks or meetings.

system
  Can rebuild projections, read events/projections.
  Cannot write tasks, post messages, or create artifacts.
```

## Default Allowed Commands

```txt
git status
git diff
git log
npm test
npm run build
npm run lint
pnpm test
pnpm build
```

## Default Blocked Actions

- Reading SSH keys.
- Reading browser credentials.
- Reading unknown secret files.
- Running unknown remote scripts.
- Deleting large directory trees.
- Automatically pushing to remote.
- Automatically merging to main.
- Modifying production deployment settings without approval.

## Required User Approval

AgentMesa should ask for explicit user approval before:

- Adding production dependencies.
- Deleting many files.
- Modifying authentication, payment, deployment, or secret handling logic.
- Pushing commits.
- Opening or merging pull requests.
- Executing irreversible shell commands.

## Policy CLI

```txt
# Check if an action is allowed for a specific actor/role
mesa policy check task.delete task_01 --actor builder --role builder --json

# Inspect the full role-capability matrix
mesa policy inspect
mesa policy inspect --json
```

## Configuration

In `.agentmesa/config.json`:

```json
{
  "protocolVersion": "0.2.0",
  "policy": {
    "mode": "role-based"
  }
}
```

When `mode` is omitted or set to `"allow-all"`, all actions are permitted (local dev default). Set to `"role-based"` to enable enforcement.

## Limitations

The current policy model is role-based (RBAC), not attribute-based (ABAC). Context-aware checks (requiring specific task state, meeting phase, or time window) are not yet enforced. This is not yet a complete security model — it enforces coarse-grained role boundaries while finer-grained checks remain design intent.
