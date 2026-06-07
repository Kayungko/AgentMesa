# AgentMesa Architecture

## Overview

AgentMesa is a layered local system for coordinating AI coding agents.

```txt
┌────────────────────────────────────┐
│ Claude Plugin / Codex Skill / CLI   │
└─────────────────┬──────────────────┘
                  │ MCP / CLI
┌─────────────────▼──────────────────┐
│            Mesa MCP Server          │
└─────────────────┬──────────────────┘
                  │
┌─────────────────▼──────────────────┐
│              Mesa Core              │
│ tasks / messages / artifacts / state│
└─────────────────┬──────────────────┘
                  │
┌─────────────────▼──────────────────┐
│           Local Workspace           │
│ .agentmesa / git / worktrees        │
└────────────────────────────────────┘
```

## Layer 1: Mesa Protocol

Defines the shared language:

- Meeting
- Task
- Agent
- Message
- Artifact
- Status
- Event
- Permission

## Layer 2: Mesa Core

Stores and manages local collaboration state:

- Create and update tasks.
- Append messages.
- Save artifacts.
- Manage locks.
- Track status transitions.
- Provide read/write APIs to MCP, CLI, and runners.

## Layer 3: Mesa MCP Server

Exposes Mesa Core as MCP tools:

- mesa_create_task
- mesa_list_tasks
- mesa_read_task
- mesa_request_review
- mesa_submit_review
- mesa_update_status
- mesa_attach_artifact
- mesa_get_git_diff

## Layer 4: Mesa Runner

Actually invokes agents:

- codex-review
- claude-fix
- test
- document

The runner should generate prompts from task state, invoke a connector, capture output, and update Mesa Core.

## Layer 5: Connectors

Adapters for specific tools:

- Claude Code connector
- Codex connector
- Git connector
- Shell connector
- Future Cursor/Gemini/GitHub connectors

## Layer 6: Plugins

Tool-facing packaging:

- Claude Code plugin with skills, commands, hooks, and MCP config.
- Codex skill/config package with AGENTS.md guidance and MCP config.

## Local Data Directory

```txt
.agentmesa/
  meetings/
  tasks/
  messages/
  artifacts/
  logs/
  locks/
  state.sqlite
```

The first version can use files only. SQLite can be added later for faster querying and dashboard support.
