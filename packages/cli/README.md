# @agentmesa/cli

Command line interface for AgentMesa.

## Commands

### State

```bash
mesa init                                     # Initialize the AgentMesa workspace
mesa task create "Implement feature"          # Tasks / messages / artifacts / meetings / agents
mesa task list --json
mesa agent add codex "Codex" reviewer         # Register an agent in the registry
mesa agent list
```

### Inspection

```bash
mesa doctor [--fix]                           # Host-environment health check (workspace, CLI/MCP integrations, projections, locks)
mesa doctor --as-agent [--actor <id>] [--json] # Agent-perspective self-check (strictly read-only)
mesa rebuild                                  # Rebuild all projections from events
mesa events list --task <id>                  # Event log inspection
mesa timeline <id>                            # Task/meeting timeline
mesa why <id>                                 # Why is this task/meeting stuck? (causal chain + conclusion)
mesa why task <id> [--json]                   # Task status chain, per-step causes, current blocker
mesa why meeting <id> [--json]                # Meeting status chain + task snapshot + blocker
mesa transports                               # Transport + envelope inspection
mesa policy inspect                           # Role capability matrix
```

## `mesa why`

Answers the debugging question agents actually have: "why does this task sit
in its current status?" It replays the event log and rebuilds the causal
chain — every status transition annotated with who did it, when, and which
preceding events (messages, runs, checks, workflow decisions) triggered it —
then classifies the current blocking point.

Human output: header → status chain with per-step causes → full timeline →
related runs/artifacts → `Conclusion:` section with the blocker kind
(`waiting_review`, `waiting_user_decision`, `waiting_workflow_approval`,
`needs_fix`, `stalled`, `failed`, `blocked`, `active`, `terminal`, …), its
confidence (`evidenced` / `inferred` / `unknown`) and the evidence event ids.

`--json` prints the full structured result (`statusChain`, `timeline`,
`blocker`, `relatedRuns`, `relatedArtifacts`, `lastActivityAt`) — safe for
local AI consumption. The analysis is strictly read-only and conservative:
when the log carries no evidence for a cause, the output says `unknown`
instead of inventing one.

```bash
mesa why task task_e5f6a7b8            # auto-detects task vs meeting
mesa why task task_e5f6a7b8 --json
mesa why meeting meeting_12345678
```

## `mesa doctor --as-agent`

Self-check from the AI agent's point of view: "Am I registered? Are my
permissions enough? Can I post, request reviews, and run checks?" It inspects
configuration only — it never starts a server and never writes to the
workspace, the global mesa home, or the room store.

The actor id comes from `--actor` (e.g. `--actor agent:codex`), falling back to
the `AGENTMESA_MCP_ACTOR_ID` environment variable.

Check groups:

1. **Workspace** — `.agentmesa/` exists, `config.json` parses, protocol version is compatible, policy mode.
2. **Identity** — the actor's agent is registered in the agent registry (with the register command on failure, and registry/env role-drift detection).
3. **Rooms** — rooms the agent is a member of (cross-workspace room store).
4. **Permissions** — role capability matrix probe: post message, room message, request/submit review, submit check result, create runs, status transitions, tasks, artifacts, invites, event/projection reads. Denied operations are listed with the policy reason.
5. **MCP channel** — stdio registration with Claude/Codex CLIs, actor binding env, and HTTP mode config (`AGENTMESA_MCP_TRANSPORT`, loopback host, bearer token, port) — config-only, no server is started.
6. **Events** — event log exists/validates and per-stream cursor sequence continuity.

Every check reports `PASS` / `WARN` / `FAIL` with a concrete fix suggestion.
The process exits with code 1 when any check fails.

With `--json` the full structured report is printed:

```jsonc
{
  "mode": "as-agent",
  "actor": { "id": "agent:codex", "agentId": "codex", "source": "flag" },
  "checks": [
    {
      "group": "permissions",          // workspace | identity | rooms | permissions | mcp | events
      "name": "capability-matrix",
      "status": "warn",                // pass | warn | fail
      "message": "Roles [reviewer]: 8 of 11 probed operations allowed; 3 denied.",
      "detail": { "allowed": [...], "denied": [{ "label": "...", "action": "...", "reason": "..." }] },
      "recommendation": "..."
    }
  ],
  "summary": { "total": 18, "pass": 12, "warn": 5, "fail": 1 }
}
```
