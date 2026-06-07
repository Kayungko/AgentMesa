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

## Phase 0: Design and Scope ✅

- Product positioning.
- Architecture design.
- Protocol draft.
- Security model.
- Connector model.
- Full development plan.

## Phase 1: Engineering Foundation ✅

- TypeScript monorepo.
- pnpm workspace.
- Build system.
- Linting and formatting.
- Test framework.
- CI workflow.
- Package boundaries.

## Phase 2: Protocol and Schemas ✅

- Mesa Protocol TypeScript types (Agent, Task, Message, Artifact, Meeting, Permission, Capability).
- Zod runtime validation schemas with input schemas for create operations.
- Status lifecycle with 12 states, transition rules, and helper functions.
- Message/event taxonomy (9 message types).
- Artifact kinds (9 types) with metadata support.
- Fixtures and examples for all entities.
- 53 protocol tests passing.

## Phase 3: Mesa Core ✅

- `.agentmesa/` workspace manager with init, config, and path utilities.
- Task service (CRUD, status transitions, assignment).
- Meeting service (CRUD, status updates, task/agent membership).
- Message service (append-only log, filtering by task).
- Artifact service (CRUD, filtering by task and kind).
- Agent registry (register, get, list).
- Lock manager (file-based locking).
- Error model with typed error classes.
- File-based JSON storage layer.
- 49 core tests passing.

## Phase 4: Mesa CLI ✅

- Hand-rolled argument parser with `--json` and `--help` flags.
- `mesa init` — workspace initialization.
- `mesa doctor` — workspace health check.
- Task commands: `create`, `list`, `show`, `status`, `assign`.
- Message commands: `list` (with task filter).
- Artifact commands: `list`, `show` (with task/kind filter).
- Meeting commands: `create`, `list`, `show`.
- Agent commands: `add`, `list`.
- Human-friendly and JSON output modes.
- 16 CLI tests passing.

## Phase 5: Git and Shell Connectors ✅

- Git connector (`@agentmesa/connector-git`):
  - `gitStatus`, `gitDiff`, `gitChangedFiles`, `gitLog`, `gitCreateBranch`.
  - `gitCurrentCommit`, `gitCurrentBranch`, `gitIsRepo`.
  - `createGitDiffArtifact` — stores diff as Mesa artifact.
  - Zero external dependencies (uses `child_process`).
  - 10 git tests passing.
- Shell connector (`@agentmesa/connector-shell`):
  - Command allowlist with dangerous pattern detection.
  - `runCheck` — execute allowed commands with timeout and output capture.
  - `createCheckResultArtifact` — stores check result as Mesa artifact.
  - 22 shell tests passing.

## Phase 6: Mesa MCP Server ✅

- MCP server package (`@agentmesa/mcp-server`) with JSON-RPC transport.
- Tool handlers for task creation, listing, status updates, handoffs, and agent registration.
- Resource handlers for tasks, meetings, messages, and artifacts.
- Integration with Mesa Core services for state management.
- 26 MCP server tests passing.

## Phase 7: Mesa Runner ✅

- Runner package (`@agentmesa/runner`) with pluggable agent runners.
- Prompt builder with templates for review, fix, and status workflows.
- Output parsers that convert agent responses into Mesa messages and artifacts.
- Runner factory supporting Claude, Codex, and Shell runner types.
- 32 runner tests passing.

## Phase 8: Claude Code Plugin ✅

- Plugin package (`@agentmesa/plugin-claude`) with install orchestrator.
- CLAUDE.md generator — produces project-aware agent instructions with Mesa commands, task context, and workflow guidance.
- Skills generator — defines `mesa-handoff`, `mesa-status`, and `mesa-review` skills with structured prompts.
- Hooks generator — configures pre/post task lifecycle hooks for automated Mesa state updates.
- MCP config generator — writes `.claude/mcp.json` pointing at the local Mesa MCP server.
- 19 plugin-claude tests passing.

## Phase 9: Codex Skill / Plugin ✅

- Plugin package (`@agentmesa/plugin-codex`) with install orchestrator.
- AGENTS.md generator — produces Codex-compatible agent definitions with Mesa roles and task context.
- Review skill generator — defines structured review prompts with Mesa handoff and artifact workflows.
- Review report template — generates standardized review output with verdict, findings, and next steps.
- MCP config generator — writes Codex-compatible MCP server configuration.
- Codex exec flow generator — produces non-interactive review execution scripts.
- 32 plugin-codex tests passing.

## Phase 10: Orchestrator ✅

- Workflow engine (`@agentmesa/orchestrator`) with step-based execution.
- Review/fix loop workflow — Codex reviews, Claude Code fixes, automatic re-review.
- Multi-agent task workflow with sequential and parallel step support.
- Human approval gates that pause workflow for user confirmation.
- Resume and failure handling with checkpoint state and error recovery.
- 27 orchestrator tests passing.

## Phase 11: Policy Engine ✅

- Policy engine package (`@agentmesa/policy`) with composable permission checks.
- Role capability matrix — reviewer, builder, admin roles with granular permissions.
- File access policy — path-based allow/deny rules with glob pattern support.
- Command policy — command pattern validation with dangerous pattern blocking.
- Secret protection — regex-based detection for API keys, tokens, and credentials.
- User confirmation gates for sensitive operations.
- 64 policy tests passing.

## Phase 12: GitHub and CI Integrations ✅

- PR linking.
- PR diff import.
- Review artifact export.
- CI result import.
- GitHub discussion import.
- 12 connector-github tests passing.

## Phase 13: Optional Mesa Desk ✅

- Task board.
- Meeting timeline.
- Artifact viewer.
- Diff viewer.
- Agent status.
- Policy settings.
- 14 desk tests passing.

## Phase 14: Packaging and 1.0 Release ✅

- npm packages.
- CLI binary.
- Plugin packages.
- Install guides.
- Connector guides.
- Troubleshooting docs.
- End-to-end examples.
- All 13 packages at version 0.1.0, building and publishing-ready.

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
