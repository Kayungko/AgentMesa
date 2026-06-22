# AgentMesa Claude Plugin

`@agentmesa/plugin-claude` generates the Claude Code integration for an AgentMesa
workspace: an MCP launcher config, a `CLAUDE.md` section, skill files, and a Stop hook.
Each generator is a pure function returning strings; `installClaudePlugin` writes them to
disk.

## Generated artifacts

- **MCP launcher** (`generateMcpConfig`) — wires the `agentmesa` MCP server into a Claude
  client config. Defaults to the `mesa-mcp` stdio bin shipped by
  [`@agentmesa/mcp-server`](../../packages/mcp-server/README.md), with the actor passed
  via environment (operator-configured, not client-supplied):

  ```jsonc
  {
    "mcpServers": {
      "agentmesa": {
        "command": "mesa-mcp",
        "args": [],
        "cwd": ".",
        "env": {
          "AGENTMESA_MCP_ACTOR_ID": "agent:claude",
          "AGENTMESA_MCP_ACTOR_ROLES": "builder"
        }
      }
    }
  }
  ```

  Pass `mcpServerPath` to launch via `node <…/dist/bin.js>` instead of the bin; override
  `actorId` / `actorRoles` / `cwd` as needed.

- **CLAUDE.md** (`generateClaudeMd`) — builder + fix rules, an MCP tool catalog, optional
  current-task / agent tables, and a Mesa CLI quick reference. All references use the real
  MCP tool names (`mesa_update_status`, `mesa_attach_artifact`, `mesa_request_review`, …)
  and real CLI subcommands (`mesa task show`, `mesa task status`, `mesa runs exec`,
  `mesa workflow run`).

- **Skills** (`generateSkillFiles`) — six skill files under `.claude/skills/`:
  - `agentmesa-meet` — create a meeting (`mesa_create_meeting`).
  - `agentmesa-handoff` — hand off via the handoff loop
    (`mesa_request_handoff` / `mesa_submit_handoff_result` / `mesa_list_handoffs`).
  - `agentmesa-fix-from-review` — read the `review_report` and re-request review.
  - `agentmesa-status` — read/update task status (`mesa_read_task` / `mesa_update_status`).
  - `agentmesa-run` — create and execute an agent run
    (`mesa_create_run` → `mesa_exec_run`).
  - `agentmesa-review` — review a `ready_for_review` task and submit a verdict
    (`mesa_list_tasks` → `mesa_read_task` → `mesa_list_artifacts` → `mesa_submit_review`).

- **Hook** (`generateHookConfig`) — a `Stop` hook that reminds the agent to mark the task
  `ready_for_review` and request review when implementation completes.

## Builder → review → handoff loop

1. The builder agent implements a task and calls `mesa_update_status` →
   `ready_for_review`, attaching an `implementation_summary` artifact.
2. It requests review with `mesa_request_review`, or hands off a specific run/artifact
   with `mesa_request_handoff`.
3. A reviewer runs the `agentmesa-review` skill and submits a verdict via
   `mesa_submit_review` (or `mesa_submit_handoff_result`).
4. On `changes_requested`, the builder runs `agentmesa-fix-from-review` and re-requests
   review.

## Install

```ts
import { installClaudePlugin } from '@agentmesa/plugin-claude';

installClaudePlugin(process.cwd(), {
  claudeMd: { projectName: 'MyApp' },
  mcpConfig: { actorId: 'agent:claude', actorRoles: 'builder' },
});
```
