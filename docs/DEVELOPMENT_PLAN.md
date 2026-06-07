# AgentMesa Full Development Plan

This document describes the complete development plan for AgentMesa. The target is not a minimal MVP. The target is a full plugin-first AI agent collaboration system.

## 1. Product Target

AgentMesa should become a complete local-first collaboration layer for AI coding agents.

The full product should allow multiple coding agents to:

- Join a shared project meeting.
- Read and write structured task context.
- Exchange implementation summaries, review reports, test results, and decisions.
- Request review or fixes from another agent.
- Run safe, permission-controlled local checks.
- Preserve all discussion artifacts and state transitions.
- Integrate with Claude Code, Codex, Git, shell tools, and future agent tools through connectors.

## 2. Final Product Shape

AgentMesa should be delivered as a plugin-first toolkit rather than a standalone IDE.

Primary entry points:

- Claude Code plugin.
- Codex skill/config/plugin.
- Mesa MCP Server.
- Mesa CLI.

Secondary or later entry points:

- VS Code extension.
- Optional Mesa Desk visual monitor.
- GitHub PR integration.
- CI integration.

## 3. Complete System Modules

```txt
AgentMesa
  ├── Mesa Protocol
  ├── Mesa Core
  ├── Mesa Storage
  ├── Mesa MCP Server
  ├── Mesa CLI
  ├── Mesa Runner
  ├── Mesa Orchestrator
  ├── Mesa Permission Engine
  ├── Mesa Connectors
  │   ├── Claude Code Connector
  │   ├── Codex Connector
  │   ├── Git Connector
  │   ├── Shell Connector
  │   ├── GitHub Connector
  │   ├── Cursor Connector
  │   └── Gemini Connector
  ├── Agent Plugins
  │   ├── Claude Code Plugin
  │   └── Codex Skill / Plugin
  ├── Templates
  ├── Examples
  ├── Test Harness
  └── Optional Mesa Desk
```

## 4. Development Principles

1. Build protocol and core first.
2. Keep plugin integrations thin.
3. Make every state transition explicit.
4. Keep local workspace state readable by humans.
5. Prefer files first, add SQLite for indexed state.
6. Never let agents silently execute risky actions.
7. Make each package usable independently.
8. Treat Claude and Codex as connectors, not hard dependencies.

## 5. Complete Development Phases

## Phase 1: Repository and Engineering Foundation

Goal: create a professional monorepo foundation for the full product.

Deliverables:

- Package manager workspace setup.
- TypeScript config.
- ESLint and formatter config.
- Unit test framework.
- Build pipeline.
- GitHub Actions CI.
- Versioning and release strategy.
- Package naming rules.
- Contribution rules.

Recommended stack:

- TypeScript.
- pnpm workspace.
- tsup or tsdown for package builds.
- vitest for tests.
- zod or TypeBox for schema validation.
- commander or cac for CLI.
- better-sqlite3 or sqlite-wasm depending on runtime target.

Outputs:

```txt
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.js
vitest.config.ts
.github/workflows/ci.yml
packages/*/package.json
```

## Phase 2: Mesa Protocol

Goal: define the stable communication contract.

Packages:

```txt
packages/protocol
```

Deliverables:

- TypeScript types.
- JSON schemas.
- Runtime validators.
- Status lifecycle rules.
- Message event definitions.
- Artifact definitions.
- Permission definitions.
- Protocol versioning.
- Backward-compatible migration design.

Core entities:

- Meeting
- Task
- Agent
- Message
- Artifact
- Decision
- Permission
- Capability
- Workflow
- CheckResult
- ReviewResult

Acceptance criteria:

- Protocol schema can validate sample tasks and messages.
- Invalid status transitions are rejected.
- Protocol version is included in every durable state object.
- Fixtures exist for builder/reviewer/fixer/tester flows.

## Phase 3: Mesa Core

Goal: implement local task bus and state engine.

Packages:

```txt
packages/core
```

Deliverables:

- Workspace initialization.
- `.agentmesa/` directory manager.
- Task CRUD.
- Meeting CRUD.
- Append-only message log.
- Artifact writer and reader.
- State transition engine.
- Lock manager.
- Agent registry.
- Config loader.
- Error model.

Storage strategy:

```txt
.agentmesa/
  config.json
  meetings/
  tasks/
  messages/
  artifacts/
  agents/
  logs/
  locks/
  state.sqlite
```

Full version should support both:

- Human-readable file state.
- SQLite index for fast queries.

Acceptance criteria:

- Core works without Claude or Codex installed.
- Core can create, update, and query tasks.
- Core can reconstruct a meeting timeline from message logs.
- Core can detect and reject stale writes where appropriate.
- Core has unit tests for status transitions and locking.

## Phase 4: Mesa CLI

Goal: provide a reliable command line interface for users and scripts.

Packages:

```txt
packages/cli
```

Deliverables:

```bash
mesa init
mesa doctor
mesa config get
mesa config set
mesa agent list
mesa agent add
mesa meeting create
mesa meeting show
mesa task create
mesa task list
mesa task show
mesa task update
mesa task status
mesa message list
mesa artifact list
mesa handoff
mesa review request
mesa review submit
mesa run
mesa serve
mesa install claude
mesa install codex
```

Acceptance criteria:

- CLI can initialize a fresh repository.
- CLI can operate entirely offline.
- CLI produces structured output with `--json`.
- CLI has readable human output by default.
- CLI can run `mesa doctor` to detect missing Claude/Codex/MCP configuration.

## Phase 5: Mesa MCP Server

Goal: expose AgentMesa operations as MCP tools for AI agents.

Packages:

```txt
packages/mcp-server
```

Deliverables:

MCP tools:

```txt
mesa_create_task
mesa_list_tasks
mesa_read_task
mesa_update_task
mesa_update_status
mesa_post_message
mesa_request_review
mesa_submit_review
mesa_attach_artifact
mesa_list_artifacts
mesa_get_git_status
mesa_get_git_diff
mesa_get_changed_files
mesa_run_check
mesa_request_user_decision
mesa_list_agents
mesa_read_meeting
```

MCP resources:

```txt
mesa://tasks/{taskId}
mesa://meetings/{meetingId}
mesa://artifacts/{taskId}/{artifactName}
mesa://timeline/{meetingId}
```

Acceptance criteria:

- Claude and Codex can both connect to the same local MCP server.
- MCP tools enforce permission rules.
- MCP tools never expose secrets by default.
- Tool results are structured and easy for agents to consume.

## Phase 6: Git and Shell Connectors

Goal: provide safe project context and check execution.

Packages:

```txt
packages/connectors/git
packages/connectors/shell
```

Git connector deliverables:

- Read git status.
- Read git diff.
- List changed files.
- Create branches.
- Create worktrees.
- Track base/head commits.
- Detect conflicts.
- Generate patch artifacts.

Shell connector deliverables:

- Command allowlist.
- Command timeout.
- Output capture.
- Check result artifact.
- Safety classification.

Acceptance criteria:

- Reviewers can read diffs without modifying files.
- Builders can operate in isolated worktrees when configured.
- Shell commands outside the allowlist are blocked by default.

## Phase 7: Mesa Runner

Goal: actually invoke agents and convert their output back into Mesa state.

Packages:

```txt
packages/runner
```

Deliverables:

- Runner interface.
- Prompt builder.
- Output parser.
- Agent process invocation.
- Timeout and retry policy.
- Run logs.
- Dry-run mode.
- Non-interactive Claude runner.
- Non-interactive Codex runner.

Runner types:

```txt
claude-implement
claude-fix
codex-review
codex-test
shell-check
document
```

Acceptance criteria:

- `mesa run codex-review T-0001` reads task state, invokes Codex, writes review report, and updates task status.
- `mesa run claude-fix T-0001` reads review report, invokes Claude, writes fix summary, and requests review again.
- Runner can be disabled in environments where automatic invocation is not desired.

## Phase 8: Mesa Orchestrator

Goal: coordinate complete multi-agent workflows.

Packages:

```txt
packages/orchestrator
```

Deliverables:

- Workflow definition format.
- Workflow engine.
- Default Claude -> Codex -> Claude -> Codex loop.
- Planner -> Builder -> Reviewer -> Tester -> Documenter flow.
- Max loop count.
- Failure handling.
- Human decision gates.
- Role assignment.
- Policy-aware routing.

Example workflow:

```txt
user_request
  -> planner
  -> builder
  -> reviewer
  -> fixer if changes_requested
  -> tester
  -> documenter
  -> user_approval
  -> done
```

Acceptance criteria:

- Workflow can pause on `needs_user_decision`.
- Workflow can recover from failed agent runs.
- Workflow can prevent infinite review/fix loops.
- Workflow can be inspected and resumed.

## Phase 9: Claude Code Plugin

Goal: make AgentMesa feel native inside Claude Code.

Path:

```txt
plugins/claude
```

Deliverables:

- Claude plugin manifest.
- AgentMesa skill.
- Commands:
  - `/agentmesa:meet`
  - `/agentmesa:handoff`
  - `/agentmesa:request-review`
  - `/agentmesa:read-review`
  - `/agentmesa:fix-from-review`
  - `/agentmesa:status`
- MCP configuration template.
- Hooks for handoff reminders.
- CLAUDE.md generator.

Acceptance criteria:

- Claude can create and update tasks through Mesa MCP.
- Claude can request Codex review after implementation.
- Claude can read review artifacts and fix issues.
- Claude plugin installation is repeatable through CLI.

## Phase 10: Codex Skill / Plugin

Goal: make Codex a reliable reviewer/tester in the AgentMesa flow.

Path:

```txt
plugins/codex
```

Deliverables:

- Codex review skill.
- Codex test skill.
- AGENTS.md generator.
- `.codex/config.toml` generator.
- MCP configuration template.
- Review report templates.
- Non-interactive review prompt templates.

Acceptance criteria:

- Codex can discover ready-for-review tasks.
- Codex can read task context and git diff.
- Codex can write structured review reports.
- Codex can mark tasks as `approved` or `changes_requested`.

## Phase 11: Permission and Policy Engine

Goal: make the full system safe by default.

Packages:

```txt
packages/policy
```

Deliverables:

- Permission model.
- Role capability matrix.
- Command allowlist.
- File access rules.
- Secret path protection.
- User approval gate.
- Audit log.

Roles:

```txt
chair
planner
builder
reviewer
tester
documenter
maintainer
owner
```

Acceptance criteria:

- Reviewer cannot write source files unless policy allows it.
- Builder cannot push or merge unless user approves.
- Shell connector blocks risky commands.
- Sensitive files are protected by default.

## Phase 12: Optional Mesa Desk

Goal: provide visual observability without becoming the primary IDE.

Packages:

```txt
packages/desk
```

Deliverables:

- Local web UI.
- Task board.
- Meeting timeline.
- Agent status view.
- Artifact viewer.
- Diff viewer.
- Config page.
- Permission page.

Acceptance criteria:

- Desk can run as `mesa desk`.
- Desk reads the same local Mesa Core state.
- Desk is optional; all core workflows work without it.

## Phase 13: GitHub and CI Integration

Goal: support real team workflows.

Packages:

```txt
packages/connectors/github
packages/connectors/ci
```

Deliverables:

- Create PR from approved task.
- Attach review artifacts to PR.
- Read PR diff.
- Write GitHub review comments.
- Read CI status.
- Retry failed checks when allowed.
- Convert PR discussion into Mesa messages.

Acceptance criteria:

- AgentMesa can link a task to a PR.
- AgentMesa can import PR review comments as messages.
- CI results can become check artifacts.
- Merge remains user-approved by default.

## Phase 14: Packaging and Distribution

Goal: make AgentMesa installable and usable.

Deliverables:

- npm packages.
- CLI binary.
- Plugin package archives.
- Release notes.
- Version policy.
- Install guide.
- Upgrade guide.

Suggested packages:

```txt
@agentmesa/protocol
@agentmesa/core
@agentmesa/cli
@agentmesa/mcp-server
@agentmesa/runner
@agentmesa/orchestrator
@agentmesa/connectors
@agentmesa/policy
```

## Phase 15: Full Product Quality Gate

Goal: ensure the complete product is stable enough for real use.

Required test layers:

- Unit tests.
- Integration tests.
- CLI snapshot tests.
- MCP tool tests.
- Connector contract tests.
- End-to-end Claude/Codex simulation tests.
- Security policy tests.
- Fixture-based workflow tests.

Full product completion criteria:

- Protocol is stable and versioned.
- Core state is durable and recoverable.
- CLI can manage all workflows.
- MCP server supports all core tools.
- Claude plugin and Codex skill both work.
- Runner can invoke both agents or run in manual mode.
- Orchestrator can automate complete workflows.
- Policy engine blocks unsafe actions.
- Optional Desk can inspect state.
- Docs include installation, usage, connector, security, and troubleshooting guides.

## 6. Recommended Build Order

Even though the target is the full product, the development order should reduce risk.

```txt
1. Engineering foundation
2. Protocol
3. Core
4. CLI
5. Git/Shell connectors
6. MCP server
7. Runner
8. Claude plugin
9. Codex skill/plugin
10. Orchestrator
11. Policy engine hardening
12. Desk
13. GitHub/CI integration
14. Packaging and release
```

## 7. Non-Goals

AgentMesa should not become:

- A replacement for Claude Code or Codex.
- A general human video meeting app.
- A cloud-first agent platform by default.
- A system that silently grants agents broad file system or shell access.
- A tool that automatically merges code without user approval.

## 8. Definition of Complete Product

AgentMesa is considered complete when a user can install it in a real project and run a full multi-agent development workflow:

```txt
Create task
  -> assign Claude as builder
  -> implementation artifact saved
  -> assign Codex as reviewer
  -> review artifact saved
  -> Claude fixes requested changes
  -> Codex approves
  -> tests run
  -> documentation generated
  -> user approves delivery
  -> optional PR created
```

The entire workflow should be visible, recoverable, auditable, and safe by default.
