# AgentMesa Implementation Schedule

AgentMesa targets a complete plugin-first cross-client meeting layer for AI coding agents, not a minimal MVP.

## Workstreams

```txt
A. Protocol and Core
B. CLI and Developer Experience
C. MCP and Agent Connectors
D. Runner and Orchestrator
E. Policy and Safety
F. Distribution, Docs, and Examples
```

## Milestones

| Milestone | Focus | Output |
|---|---|---|
| M0 | Engineering foundation | TypeScript monorepo, CI, package boundaries |
| M1 | Mesa Protocol | Schemas, validators, fixtures, status lifecycle |
| M2 | Mesa Core + Storage | `.agentmesa/`, task/message/artifact services |
| M3 | CLI + Git/Shell | `mesa init`, task commands, git diff, safe checks |
| M4 | Mesa MCP Server | MCP tools and resources for agents |
| M5 | Runner Layer | Codex review runner, Claude fix runner |
| M6 | Claude/Codex Integrations | Claude plugin, Codex skill/config |
| M7 | Orchestrator + Policy | Review/fix workflow, permissions, approval gates |
| M8 | GitHub/CI + Desk Preview | PR linking, CI import, optional visual monitor |
| M9 | Hardening + 1.0 Prep | Docs, tests, packaging, release candidate |

## Current Execution Target

All milestones M0 through M9 are **complete**. AgentMesa is feature-complete for the 0.1.0 release. Next: **Preparing for 1.0 stable release**.

### Completed Milestones

**M0 — Engineering Foundation** ✅

- Root package workspace.
- Package manager config.
- TypeScript config.
- Lint/format/test/build scripts.
- GitHub Actions CI.
- Initial package skeletons.
- Initial protocol and core source entry points.

**M1 — Mesa Protocol** ✅

- Complete TypeScript types for all protocol entities.
- Zod runtime validation schemas.
- Status lifecycle with 12 states and transition rules.
- Message and artifact taxonomy.
- Fixture data for all entities.
- 53 protocol tests passing.

**M2 — Mesa Core + Storage** ✅

- `.agentmesa/` workspace init with config management.
- Task, Meeting, Message, Artifact CRUD services.
- Agent registry.
- File-based locking.
- Error model with typed errors.
- File-based JSON storage.
- 49 core tests passing.

**M3 — CLI + Git/Shell Connectors** ✅

- Full CLI with task/message/artifact/meeting/agent commands.
- `mesa init` and `mesa doctor` for workspace management.
- `--json` output mode for scripting.
- Git connector: status, diff, log, branch, changed files.
- Shell connector: command allowlist, timeout, output capture.
- 48 CLI + connector tests passing.

**M4 — Mesa MCP Server** ✅

- MCP server package with JSON-RPC transport layer.
- Tool handlers for task CRUD, status transitions, handoffs, and agent registration.
- Resource handlers exposing tasks, meetings, messages, and artifacts to agents.
- Full integration with Mesa Core services.
- 26 MCP server tests passing.

**M5 — Runner Layer** ✅

- Runner package with pluggable agent runner interface.
- Prompt builder with review, fix, and status workflow templates.
- Output parsers converting agent responses into Mesa messages and artifacts.
- Runner factory supporting Claude, Codex, and Shell runner types.
- 32 runner tests passing.

**M6 — Claude/Codex Integrations** ✅

- Claude Code plugin (`@agentmesa/plugin-claude`) with CLAUDE.md generator, skills, hooks, and MCP config generators.
- Codex plugin (`@agentmesa/plugin-codex`) with AGENTS.md generator, review skill, review report template, MCP config, and exec flow generators.
- Install orchestrators for both plugins.
- 51 plugin tests passing (19 Claude + 32 Codex).

**M7 — Orchestrator + Policy** ✅

- Orchestrator package (`@agentmesa/orchestrator`) with workflow engine, review/fix loop, multi-agent task workflows, human approval gates, and resume/failure handling.
- Policy engine package (`@agentmesa/policy`) with role capability matrix, file access policy, command policy, secret protection, and user confirmation gates.
- 91 orchestrator + policy tests passing (27 orchestrator + 64 policy).
- **Total: 350 tests across 11 packages.**

**M8 — GitHub/CI + Desk Preview** ✅

- GitHub connector (`@agentmesa/connector-github`) with PR linking, PR diff import, review artifact export, CI result import, and GitHub discussion import.
- Desk package (`@agentmesa/desk`) with task board, meeting timeline, artifact viewer, diff viewer, agent status, and policy settings.
- 26 GitHub/CI + Desk tests passing (12 github + 14 desk).

**M9 — Hardening + 1.0 Prep** ✅

- All 13 packages updated to version 0.1.0.
- Build system verified across all packages (tsup ESM + DTS).
- Full test suite: 376 tests across 13 packages, all passing.
- Typecheck passing across all 13 packages.
- Documentation updated to reflect feature-complete status.
- **Total: 376 tests across 13 packages.**

## Build Order

```txt
1. Engineering foundation
2. Protocol package
3. Core package
4. CLI package
5. Git/Shell connectors
6. MCP server
7. Runner
8. Claude plugin
9. Codex skill/plugin
10. Orchestrator
11. Policy engine
12. GitHub/CI connector
13. Optional Desk
14. Packaging and 1.0 release
```
