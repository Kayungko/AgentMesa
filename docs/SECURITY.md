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
| Role-based policy engine | **Enforced in tests.** `RoleBasedPolicyEngine` maps 23 actions → 14 capabilities with per-role sets. Production roles: owner, admin, builder, reviewer, connector, ci, system, read_only. |
| Default mode | **New workspaces default to `RoleBasedPolicyEngine`** — `mesa init` (or any first `createRuntimeContext` call against a directory with no `.agentmesa/config.json` yet) writes `policy.mode: "role-based"`. Pre-existing workspaces are not retroactively affected: a `config.json` already on disk without a `policy` field keeps resolving to `AllowAllMesaPolicyEngine`. |
| Production mode | Already the default for new workspaces. Pre-existing workspaces opt in by setting `policy.mode: "role-based"` in `.agentmesa/config.json`. Set `policy.mode: "allow-all"` to opt back out. |
| Context-aware policy | **Enforced.** `canWithContext()` evaluates reviewer status gates — pure reviewer may only transition to `approved` or `changes_requested`; multi-role actors (reviewer+builder/chair/admin/maintainer/owner) bypass via non-reviewer `change_status` capability. `updateTaskStatus` passes `targetStatus` via `assertPolicyWithContext()`. |
| Capability gating | `canEditFiles`, `canRunShell`, etc. not yet checked by core services (deferred — no concrete driving use case yet: today's agents are uniformly trusted CLI backends, not a heterogeneous multi-agent trust model). |

## Role-Based Access Matrix

| Action | owner | admin | builder | reviewer | connector | ci | system | read_only |
|---|---|---|---|---|---|---|---|---|
| task.create / task.assign | Y | Y | Y | — | — | — | — | — |
| task.updateStatus | Y | Y | Y | Y* | — | — | — | — |
| task.archive | Y | Y | — | — | — | — | — | — |
| task.delete | Y | Y | — | — | — | — | — | — |
| meeting.create / updateStatus / addTask / addAgent | Y | Y | Y | — | — | — | — | — |
| message.append | Y | Y | Y | Y | Y | Y | — | — |
| artifact.create | Y | Y | Y | Y | Y | Y | — | — |
| agent.register | Y | Y | Y | — | — | — | — | — |
| event.read | Y | Y | Y | Y | Y | Y | Y | Y |
| projection.read | Y | Y | Y | Y | Y | Y | Y | Y |
| projection.rebuild | Y | Y | — | — | — | — | Y | — |
| transport.inspect | Y | Y | — | — | — | — | — | — |
| meeting.updateTrustLevel | Y | Y | — | — | — | — | — | — |
| token.grant / token.revoke | Y | Y | — | — | — | — | — | — |
| run.create / run.updateStatus / run.read | Y | Y | Y | Y | — | Y | — | Y |
| handoff.write / handoff.read | Y | Y | Y | Y | — | Y | — | Y |
| check.create / check.read | Y | Y | Y | Y | — | Y | — | Y |

`*` Pure reviewer may only transition status to `approved` or `changes_requested`. Multi-role actors with another `change_status`-capable role (builder, chair, admin, maintainer, owner) are not restricted.

`run.*`/`handoff.*`/`check.*` all share one coarse-grained `manage_runs` capability (read and write are not split) — this is a known, documented limitation, not a bug. `read_only` (used by Mesa Desk) is granted `manage_runs` only so it can read handoffs; it never calls the write-side functions.

`meeting.updateTrustLevel` is deliberately split out of `manage_meetings` (2026-09-03): changing a meeting's trust level alters what OTHER permissions mean (the trusted posture lets role capabilities judge writes without approval cards), so it requires the dedicated `manage_trust_level` capability held only by owner/admin. Chair/maintainer/planner/builder lost this action in the split — they can still create/update meetings.

## Key Security Boundaries

- **Connector** (e.g., GitHub webhook, Git hook) — can post messages and create artifacts, but cannot create/delete tasks or manage meetings. This prevents external triggers from corrupting project state.
- **CI** (e.g., GitHub Actions) — can post messages and create `check_result` artifacts, but cannot modify tasks or meetings.
- **Builder** — can create and modify tasks, register agents, and create meetings, but cannot delete or archive tasks. Hard-delete is a privileged operation. (This is also the MCP server's default actor role when `AGENTMESA_MCP_ACTOR_ROLES` is unset — `manage_agents`/`manage_meetings` were added specifically so `mesa_register_agent`/`mesa_create_meeting` work out of the box.) Since the 2026-09-03 hardening, `mesa_register_agent` additionally requires an owner/admin actor for PRIVILEGED roles (owner, admin, chair, maintainer, system) — a builder can still register ordinary agents, including itself, out of the box.
- **System** — can rebuild projections and read events but cannot write tasks, post messages, or create artifacts. Internal-only role.
- **Read-only** (e.g., Mesa Desk's dashboard actor) — can read tasks, events, projections, runs, workflows, checks, and handoffs, but cannot write anything. Not a full security model — grouped under the same coarse-grained `manage_runs` capability as the write side, since Desk's code path never calls the write functions.

## HTTP Transport Identity Boundary (2026-09-03)

The MCP streamable HTTP transport never trusts connection-declared roles:

- **`x-agentmesa-actor-roles` is not adopted.** Roles are adjudicated
  server-side from the agent registry at initialize time: a registered id
  gets its registered roles; an unregistered id is downgraded to `read_only`
  (the session can still bootstrap itself — see below). Garbage values in the
  header still fail loudly with a 400, but valid-looking values are ignored.
- **The downgrade holds regardless of workspace policy mode.** Downgraded
  sessions get the role-based policy engine forced into their runtime
  context, so a legacy allow-all workspace cannot silently re-grant write
  access to an unregistered connection.
- **Self-registration bootstrap.** A downgraded session may call
  `mesa_register_agent` to register ITS OWN id under non-privileged roles
  (planner/builder/reviewer/tester/documenter/researcher/custom/connector/ci)
  — a new connection with the same id then adjudicates to those roles.
  Privileged roles (owner/admin/chair/maintainer/system) can only be granted
  by an owner/admin actor or the operator CLI (`mesa agent add`). The
  classification lists live in `packages/core/src/services/agent-registry.ts`;
  when the protocol role enum grows, new roles must be classified into
  exactly one of the two sets — never defaulted into the self-registrable
  side.

## Per-Member Tokens (2026-09-03, M3 phase 2)

Individual agents can hold their own HTTP credential — **token fixes the
identity, the registry fixes the permissions**:

- **Grant / rotate / revoke** (owner/admin only, `manage_credentials`
  capability): `mesa token grant <agentId>` / `mesa token rotate <agentId>` /
  `mesa token revoke <agentId> [--reason <text>]`, or the MCP equivalents
  `mesa_token_grant` / `mesa_token_revoke` / `mesa_token_list`. The grant
  requires the agent to already be registered.
- **Token pinning.** A member-token connection's actor id is pinned to the
  token's agent — no `x-agentmesa-actor-id` header needed, and a
  contradicting one is rejected with 400. Roles still come from the registry:
  a token grants at most the powers of the one agent it was issued to, and
  audit attribution is truthful.
- **Storage.** One JSON file per token under `.agentmesa/tokens/`, named by
  the sha256 hex of the token — lookup is a direct filename probe, never a
  comparison loop. The plaintext exists ONLY in the grant command's output;
  it is never written to the event log, projections, or any file. The event
  stream carries `token_granted` / `token_revoked` with agent/grantedBy
  metadata only.
- **Rotation is overwrite.** One agent holds at most one active token;
  re-granting deletes the previous hash file — the old token dies
  immediately, no grace window. A deliberate trade-off: no dual-token
  overlap for zero-downtime rotation; rotate at a quiet moment.
- **Revocation is per-request.** Every HTTP request re-authenticates, so a
  revoked token fails on the very next request (401). Established sessions
  are not actively torn down mid-stream — their next request is the boundary
  (server restart clears them anyway).
- **Dual-track.** The legacy shared token (`--token` / `AGENTMESA_HTTP_TOKEN`)
  keeps working unchanged: it authenticates as `shared`, and the identity
  then follows the header + registry adjudication path above. A non-loopback
  bind now accepts EITHER a shared token or at least one active member token
  as its auth credential.
- **Deliberate tightening.** On loopback without a shared token, a presented
  but invalid token used to be ignored (the gate was not armed); it now 401s.
  Anyone actively presenting credentials gets a truthful verdict.

**Known residual limitations.** Revocation does not interrupt an
already-established streamable HTTP session (its next request fails instead).
Member tokens, like the shared token, are bearer credentials — transport
security beyond loopback relies on the operator (TLS termination, network
isolation). The token files themselves are as sensitive as the tokens; the
`.agentmesa` directory must not be committed or shared.

## Permission Levels

```txt
owner
  Full authority. Bypasses all policy checks.

admin
  Same full authority as owner for management operations.

builder
  Can read/write tasks, change status, post messages, create artifacts,
  register agents, create meetings.
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

read_only
  Can read tasks, events, projections, runs, workflows, checks, handoffs.
  Cannot write anything. Used by Mesa Desk's dashboard actor.
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

When `mode` is `"allow-all"`, all actions are permitted. When `mode` is `"role-based"`, enforcement is on. New workspaces get `"role-based"` written into their config automatically; a pre-existing `config.json` that predates this change and has no `policy` field at all keeps behaving as `"allow-all"` (its absence is treated the same as an explicit `"allow-all"`, purely for backward compatibility — it is not the default for anything created going forward).

## Limitations

The current policy model is role-based (RBAC), not attribute-based (ABAC). Context-aware checks (requiring specific task state, meeting phase, or time window) are not yet enforced. This is not yet a complete security model — it enforces coarse-grained role boundaries while finer-grained checks remain design intent.
