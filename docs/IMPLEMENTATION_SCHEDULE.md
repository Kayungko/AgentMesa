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

We are executing M0 now.

M0 deliverables:

- Root package workspace.
- Package manager config.
- TypeScript config.
- Lint/format/test/build scripts.
- GitHub Actions CI.
- Initial package skeletons.
- Initial protocol and core source entry points.

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
