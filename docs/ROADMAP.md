# AgentMesa Roadmap

AgentMesa is targeting a complete plugin-first product, not a minimal MVP.

The development approach is staged, but each stage is part of the full product architecture.

## Strategic Product Target

AgentMesa should become the meeting layer for AI coding agents:

```txt
Claude Code + Codex + future agents
  -> shared meetings
  -> structured task handoffs
  -> code review loops
  -> safe local execution
  -> auditable delivery
```

## Phase 0: Design and Scope

- Product positioning.
- Architecture design.
- Protocol draft.
- Security model.
- Connector model.
- Full development plan.

## Phase 1: Engineering Foundation

- TypeScript monorepo.
- pnpm workspace.
- Build system.
- Linting and formatting.
- Test framework.
- CI workflow.
- Package boundaries.

## Phase 2: Protocol and Schemas

- Mesa Protocol TypeScript types.
- JSON schemas.
- Validators.
- Status lifecycle.
- Message/event taxonomy.
- Fixtures and examples.

## Phase 3: Mesa Core

- `.agentmesa/` workspace manager.
- Task service.
- Meeting service.
- Message service.
- Artifact service.
- Locking.
- Config.
- File storage.
- SQLite index.

## Phase 4: Mesa CLI

- `mesa init`.
- `mesa doctor`.
- Task commands.
- Meeting commands.
- Artifact commands.
- Review commands.
- Install commands.
- JSON output.

## Phase 5: Git and Shell Connectors

- Git status and diff.
- Changed files.
- Branch and worktree helpers.
- Patch artifacts.
- Safe shell command runner.
- Command allowlist.

## Phase 6: Mesa MCP Server

- MCP tools.
- MCP resources.
- Permission checks.
- Claude and Codex connection support.

## Phase 7: Mesa Runner

- Runner interface.
- Prompt builders.
- Claude runner.
- Codex runner.
- Shell runner.
- Output parsers.
- Logs and artifacts.

## Phase 8: Claude Code Plugin

- Plugin manifest.
- Skills.
- Commands.
- Hooks.
- MCP config.
- CLAUDE.md generator.

## Phase 9: Codex Skill / Plugin

- Skill files.
- AGENTS.md generator.
- MCP config.
- Review report templates.
- Non-interactive review flow.

## Phase 10: Orchestrator

- Workflow definitions.
- Review/fix loop.
- Multi-agent task workflow.
- Human approval gates.
- Resume and failure handling.

## Phase 11: Policy Engine

- Role capability matrix.
- File access policy.
- Command policy.
- Secret protection.
- Audit log.
- User confirmation gates.

## Phase 12: GitHub and CI Integrations

- PR linking.
- PR diff import.
- Review artifact export.
- CI result import.
- GitHub discussion import.

## Phase 13: Optional Mesa Desk

- Task board.
- Meeting timeline.
- Artifact viewer.
- Diff viewer.
- Agent status.
- Policy settings.

## Phase 14: Packaging and 1.0 Release

- npm packages.
- CLI binary.
- Plugin packages.
- Install guides.
- Connector guides.
- Troubleshooting docs.
- End-to-end examples.

## Full Product Completion Criteria

AgentMesa reaches the complete product target when:

- Claude and Codex can both connect through Mesa MCP.
- Tasks, messages, artifacts, and meetings are durable.
- Full review/fix/test/doc workflows are supported.
- CLI can operate and inspect all core state.
- Runner can operate in manual and automatic modes.
- Orchestrator can pause, resume, and recover workflows.
- Policy engine protects files, commands, and secrets.
- Optional Desk can visualize the system state.
- GitHub and CI integrations can connect AgentMesa to real team workflows.
