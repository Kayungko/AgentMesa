# AgentMesa Connectors

Connectors adapt external tools to Mesa Protocol.

## Connector Responsibilities

A connector should:

- Install or generate tool-specific configuration.
- Expose Mesa MCP configuration when supported.
- Provide prompts or skills for the target agent.
- Define allowed actions and permissions.
- Normalize output back into Mesa artifacts.

## Claude Connector

Purpose: allow Claude Code to act as builder, fixer, planner, or documenter.

Planned capabilities:

- Generate CLAUDE.md.
- Install Claude Code plugin files.
- Configure Mesa MCP server.
- Provide commands such as `/agentmesa:handoff` and `/agentmesa:fix-from-review`.
- Add hooks for implementation completion and review handoff.

## Codex Connector

Purpose: allow Codex to act as reviewer, tester, or secondary builder.

Planned capabilities:

- Generate AGENTS.md.
- Configure `.codex/config.toml`.
- Install AgentMesa review skill.
- Run `codex exec` for non-interactive review flows.
- Write review-report artifacts back to Mesa Core.

## Git Connector

Purpose: provide safe code context.

Planned capabilities:

- Read git status.
- Read git diff.
- List changed files.
- Create branches or worktrees.
- Track commit hashes.
- Detect conflicts.

## Shell Connector

Purpose: run approved local checks.

The shell connector must use a command allowlist.
