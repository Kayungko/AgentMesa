# @agentmesa/mcp-server

MCP server exposing the AgentMesa state layer (tasks, runs, workflows, handoffs,
events) to local AI coding agents over stdio.

## Launch

The server is shipped as a `mesa-mcp` bin that serves the AgentMesa workspace in
the current working directory over stdio:

```jsonc
// MCP client config (e.g. claude_desktop_config.json)
{
  "mcpServers": {
    "agentmesa": {
      "command": "mesa-mcp",
      "cwd": "/path/to/your/workspace",
      "env": {
        "AGENTMESA_MCP_ACTOR_ID": "agent:claude",
        "AGENTMESA_MCP_ACTOR_ROLES": "builder"
      }
    }
  }
}
```

## Actor identity

The server's actor is **operator-configured via the environment**, not taken from
client tool arguments — a connected client cannot escalate its own privileges.

| Env var                     | Default     | Meaning                                        |
| --------------------------- | ----------- | ---------------------------------------------- |
| `AGENTMESA_MCP_ACTOR_ID`    | `agent:mcp` | Actor id recorded on every mutation/event      |
| `AGENTMESA_MCP_ACTOR_ROLES` | `builder`   | Comma-separated roles used for policy checks   |

`builder` is the least-privilege default that still carries `manage_runs` /
`manage_tasks`, so the run and workflow tools work out of the box. Use
`AGENTMESA_MCP_ACTOR_ROLES` to grant more (e.g. `owner,builder`) under a role-based
policy.

## Tools

**Tasks** — `mesa_create_task`, `mesa_list_tasks`, `mesa_read_task`, `mesa_update_status`

**Messages** — `mesa_post_message`, `mesa_request_review`, `mesa_submit_review`,
`mesa_list_messages`

**Artifacts** — `mesa_attach_artifact`, `mesa_list_artifacts`

**Meetings** — `mesa_create_meeting`, `mesa_list_meetings`

**Agents** — `mesa_register_agent`, `mesa_list_agents`

**Agent runs** — `mesa_create_run`, `mesa_list_runs`, `mesa_read_run`,
`mesa_update_run_status`, `mesa_exec_run` (drives the real Claude/Codex CLI when the
runner env vars are set — see [`@agentmesa/runner`](../runner/README.md) — otherwise
the prompt-echo stub)

**Workflows** — `mesa_list_workflows`, `mesa_read_workflow`, `mesa_run_workflow`

**Handoffs** — `mesa_request_handoff`, `mesa_submit_handoff_result`, `mesa_list_handoffs`

**Events / projections** — `mesa_list_events`, `mesa_get_task_events`,
`mesa_get_meeting_events`, `mesa_get_task_projection`, `mesa_get_meeting_projection`

Every tool returns its result as a JSON string in a single text content block;
errors are returned as `{ "error": "<message>" }` with `isError: true`.

See [`docs/AGENT_RUNS.md`](../../docs/AGENT_RUNS.md) for the run/handoff/workflow
semantics behind these tools.
