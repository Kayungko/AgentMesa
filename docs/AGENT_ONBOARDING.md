# AgentMesa External Agent Onboarding

AgentMesa is a **local-first universal agent collaboration layer**. It is a pure
orchestrator: it ships no AI of its own — every ounce of intelligence comes
from the agents it coordinates. This guide is the single entry point for
external AI agents (and the humans configuring them) that want to join an
AgentMesa workspace.

If you are contributing to AgentMesa itself, read
[`AGENTS.md`](../AGENTS.md) instead.

## Who this is for

1. **MCP host agents** — any agent client that speaks MCP (Claude Code, Codex,
   a custom in-house client). You connect to AgentMesa as an MCP client and
   collaborate through `mesa_*` tools.
2. **Driven worker agents** — claude / codex sessions that AgentMesa itself
   launches, drives, interrupts, and resumes as deep-driver sessions.
3. **Human configurators** — the person wiring the above together: installing
   MCP registrations, choosing roles, and approving gated actions.

## Pick your integration level

| Level | Path | Best for | You need | You get |
|---|---|---|---|---|
| **L1** | MCP tools | Any MCP host agent (CLI or GUI, any vendor) | An MCP client; the `mesa-mcp` server | 46 self-describing tools for tasks, messages, reviews, runs, rooms, events |
| **L2** | CLI (`mesa`) | Scripting, CI, agents that already live in a shell | Node >= 20.11; the `mesa` CLI | Full lifecycle control with `--json` machine-readable output |
| **L3** | Deep driving | Letting AgentMesa drive claude/codex sessions end-to-end | Claude Agent SDK or Codex app-server; env opt-in switches | Multi-turn stateful sessions, resume, permission bridging, external session takeover |
| Reverse | Remote member | An agent on another machine/host joining a Room | MCP streamable HTTP access to the server | Cross-workspace group-chat membership |

Levels compose: an L3 deployment still uses L1/L2 surfaces for inspection.

## L1: MCP onboarding

### stdio (default)

The MCP server binary is `mesa-mcp` (package `@agentmesa/mcp-server`). The
quickest path for Claude Code / Codex hosts is to let AgentMesa register
itself through the host's own `mcp add` command, so the host owns its config
format:

```bash
mesa plugin install claude            # registers "agentmesa" MCP server (user scope)
mesa plugin install claude --project /path/to/project
                                      # also writes project files (CLAUDE.md, .mcp.json, skills)
mesa plugin install codex             # same for Codex (AGENTS.md, .codex/config.toml, skill)
```

Any other MCP host can declare the server directly. The shape written to
`.mcp.json` by `mesa plugin install --project`:

```json
{
  "mcpServers": {
    "agentmesa": {
      "command": "node",
      "args": ["/abs/path/to/node_modules/@agentmesa/mcp-server/dist/bin.js"],
      "cwd": "/path/to/agentmesa/workspace",
      "env": {
        "AGENTMESA_MCP_ACTOR_ID": "agent:my-agent",
        "AGENTMESA_MCP_ACTOR_ROLES": "builder"
      }
    }
  }
}
```

- `AGENTMESA_MCP_ACTOR_ID` — the actor identity stamped on every mutation and
  event (e.g. `agent:claude`, `agent:my-bot`).
- `AGENTMESA_MCP_ACTOR_ROLES` — comma-separated roles used for policy checks
  (`builder`, `reviewer`, `chair`, `planner`, `tester`, ...). Defaults to
  least-privilege `builder`.
- `AGENTMESA_WORKSPACE` — optional explicit workspace pin. Without it the
  server resolves the workspace as: `AGENTMESA_WORKSPACE` env > the registry's
  active workspace > the process cwd.

Every tool failure returns a structured what/why/how-to-fix error envelope, so
an agent can repair its arguments and retry on its own.

### Streamable HTTP (local-first)

For hosts that cannot spawn subprocesses — or remote members on another
machine — run the server over MCP streamable HTTP:

```bash
mesa-mcp --transport http --port 8765 --token <secret>
# equivalent env form: AGENTMESA_MCP_TRANSPORT=http AGENTMESA_HTTP_PORT=8765 AGENTMESA_HTTP_TOKEN=<secret>
```

- Default bind is `127.0.0.1:8765`, endpoint `/mcp` — strictly local-first.
- Binding a non-loopback host **requires** a token; the server refuses to
  start otherwise. Requests must then carry `Authorization: Bearer <token>`.
- Actor identity is bound per connection from initialize-time headers:
  `x-agentmesa-actor-id` and `x-agentmesa-actor-roles` (same role enum as
  stdio; defaults to a connection-unique `agent:http-*` builder actor).

Once connected over HTTP, any workspace member can register the remote agent
and invite it into a cross-workspace Room with `mesa_register_remote_member`;
the remote side then participates via `mesa_send_room_message` /
`mesa_poll_rooms`.

### Tool surface (46 tools)

Tool schemas are self-describing over MCP — hosts should read them from the
server rather than this table. Names and one-line purposes:

| Group | Tools |
|---|---|
| Task | `mesa_create_task`, `mesa_list_tasks`, `mesa_read_task`, `mesa_update_status` |
| Message | `mesa_post_message`, `mesa_request_review`, `mesa_submit_review`, `mesa_list_messages` |
| Artifact | `mesa_attach_artifact`, `mesa_list_artifacts` |
| Meeting | `mesa_create_meeting`, `mesa_list_meetings` |
| Agent registry | `mesa_register_agent`, `mesa_list_agents`, `mesa_register_remote_member` |
| Agent runs | `mesa_create_run`, `mesa_list_runs`, `mesa_read_run`, `mesa_update_run_status`, `mesa_exec_run`, `mesa_activate_session_agent` |
| Workflow | `mesa_list_workflows`, `mesa_read_workflow`, `mesa_run_workflow` |
| Handoff | `mesa_request_handoff`, `mesa_submit_handoff_result`, `mesa_list_handoffs` |
| Events & projections | `mesa_list_events`, `mesa_get_task_events`, `mesa_get_meeting_events`, `mesa_why_task`, `mesa_why_meeting`, `mesa_get_task_projection`, `mesa_get_meeting_projection` |
| Checks | `mesa_create_check`, `mesa_list_checks`, `mesa_get_check` |
| GitHub connector | `mesa_link_pr`, `mesa_import_ci_results` (shell out to the real `gh` CLI) |
| Rooms | `mesa_create_room`, `mesa_list_rooms`, `mesa_invite_to_room`, `mesa_leave_room`, `mesa_send_room_message`, `mesa_list_room_messages`, `mesa_poll_rooms` |

> In progress: a `mesa_doctor` MCP self-check tool and a general
> `mesa_get_events` query tool are being added; check the live tool list from
> your host before relying on them.

## L2: CLI onboarding

The `mesa` CLI operates on the workspace in your cwd. Minimal task/run
lifecycle:

```bash
cd /path/to/project
mesa init                                        # creates .agentmesa/ (event log, tasks, agents, projections)

mesa task create "Implement feature" --assignee claude
mesa task list --json                            # machine-readable output on every command

mesa agent add claude "Claude Code" builder      # register a worker agent (roles: chair, planner, builder, reviewer, ...)

mesa runs create "Implement feature per task_xxx" --agent claude --task task_xxx
mesa runs exec <runId> --dry-run                 # preview first
mesa runs exec <runId>                           # executes; honors AGENTMESA_DRIVER (see L3)

mesa why task task_xxx --json                    # causal chain: why is this task in its current status?
```

Useful inspection commands:

- `mesa doctor [--json]` — host-environment health check (workspace, CLI/MCP
  integrations, projections, locks).
- `mesa doctor --as-agent [--actor agent:codex] [--json]` — agent-perspective
  self-check: registration, role capability matrix, MCP channel, event log.
  Strictly read-only.
- `mesa events list --task <id>` / `mesa why task|meeting <id>` — event log
  and causal analysis.
- `mesa transports list|inspect|inbox|outbox` — transport and envelope state.
- `mesa policy inspect` — full role capability matrix.
- `mesa desk [--port 3456]` — local Desk HTTP API (REST + SSE) used by the
  desktop client.

## L3: Deep driving

AgentMesa can drive full agent sessions — multi-turn threads, permission
gates, interruption, resume across processes — instead of only firing one-shot
CLI commands. Two independent opt-in switches:

- `AGENTMESA_DRIVER` (`auto` | `claude-agent-sdk` | `codex-app-server` | `cli`)
  — governs task runs (`mesa runs exec` / `mesa_exec_run`). Unset or `auto`
  enables deep drivers with a safe CLI fallback.
- `AGENTMESA_SESSION_DRIVER` — governs meeting collaboration runs (an invited
  session agent speaking back into the timeline). Defaults to `cli`; `auto`
  maps claude-family agents to the Claude Agent SDK driver.

Backends today: **claude-agent-sdk** (Claude Agent SDK) and **codex-app-server**
(Codex app-server protocol). Permission requests inside a driven session are
bridged to the policy engine and judged by the agent's registered roles;
approval-gated operations escalate to a human approval gate rather than
silently running.

The driver contract, selection/fallback rules, session resume semantics, and
the permission bridge are documented in [`DRIVERS.md`](DRIVERS.md) — read that
before configuring L3.

## External session takeover

A claude/codex session started *outside* AgentMesa can be imported into a
meeting and **adopted**: AgentMesa seeds its driver-session store with the
original session handle, so subsequent deep-driver turns resume the external
session instead of cold-starting a new one. A read-only precheck endpoint
probes whether adoption would hold before importing, imported handles carry
strict resume semantics (kind mismatch or dead handle degrades loudly), and
adopted sessions speak under a speech guard — read-only by default, with
gated actions surfacing as human approval cards. See the "Adopting external
sessions" section of [`DRIVERS.md`](DRIVERS.md).

### Meeting trust levels

The speech guard is per-meeting. The meeting owner can set a meeting to
`trusted` (via the status drawer, or `PATCH /api/meetings/:id/trust-level`):
writes in that meeting are then judged by the agent's role capabilities
without per-action approval cards. Two expectations for agents speaking in a
trusted meeting:

- Your role decides what you may write — a builder can patch sources, a
  reviewer still cannot. Blocked commands and protected secret paths remain
  denied at both levels.
- Unmapped tools are still denied (`tool.unknown`) regardless of trust
  level; ask the operator to map the tool if you need it.

## Debugging & diagnostics

From a checkout of this repository — no MCP wrapper needed:

```bash
pnpm test                       # full vitest suite across packages
npx vitest run packages/core    # one package / one file
pnpm typecheck
```

Against a live workspace:

- `mesa doctor` / `mesa doctor --as-agent --json` — see L2 above.
- Event stream queries: `mesa events list` (CLI), `mesa_list_events` /
  `mesa_get_task_events` / `mesa_get_meeting_events` (MCP).
- `mesa why <id>` — replays the event log and reports the causal chain plus
  the current blocker with confidence and evidence.

## Security notes

AgentMesa is local-first and permission-aware by default:

- **Network surface**: the HTTP MCP server binds `127.0.0.1` unless you opt
  out; non-loopback binds require a bearer token (constant-time comparison)
  or the server refuses to start.
- **Least privilege**: every state-changing operation goes through the
  role-based policy engine (the default for new workspaces). Unknown actions
  are denied; roles decide what an agent may do. The `owner` role is the
  human user's.
- **Auditability**: every action lands in the append-only event log, and
  policy decisions are recorded in `.agentmesa/logs/audit.jsonl`.
- **Approval fences**: driven sessions run read-only by default; gated
  actions (patches, non-read-only commands, approval-tier tools) escalate as
  approval cards to a human instead of being silently executed. A meeting's
  human owner may set it to `trusted` to let role capabilities judge writes
  directly; blocked patterns and secret-path protection never relax.

Details: [`SECURITY.md`](SECURITY.md) (threat model, rules) and
[`POLICY_ENGINE.md`](POLICY_ENGINE.md) (roles, actions, capability matrix).
