# AgentMesa Engineering Plan

## 1. Monorepo Strategy

AgentMesa should use a TypeScript monorepo.

Suggested package layout:

```txt
packages/
  protocol/
  core/
  storage/
  cli/
  mcp-server/
  runner/
  orchestrator/
  policy/
  connectors/
    git/
    shell/
    claude/
    codex/
    github/
  desk/
```

## 2. Package Responsibilities

## 2.1 protocol

- Type definitions.
- JSON schemas.
- Runtime validation.
- Protocol version constants.
- Fixture data.

## 2.2 core

- Workspace initialization.
- Config loading.
- Task and meeting services.
- Message service.
- Artifact service.
- Status transition service.
- Lock service.

## 2.3 storage

- File storage adapter.
- SQLite index adapter.
- Migration utilities.

## 2.4 cli

- User-facing command line interface.
- Human and JSON output modes.
- Install and doctor commands.

## 2.5 mcp-server

- MCP server entry point.
- Tool registration.
- Tool argument validation.
- Permission enforcement.

## 2.6 runner

- Agent runner interface.
- Claude runner.
- Codex runner.
- Shell runner.
- Prompt templates.
- Output parsers.

## 2.7 orchestrator

- Workflow DSL.
- Workflow runtime.
- Resume/pause support.
- Failure handling.

## 2.8 policy

- Role definitions.
- Permission checks.
- File access policy.
- Command policy.
- User approval gates.

## 2.9 connectors

- Tool-specific adapters.
- Installers.
- Config generators.
- Capability detection.

## 2.10 desk

- Optional local web UI.
- Should consume Core APIs.

## 3. Testing Strategy

Required test layers:

- Protocol schema tests.
- Core service tests.
- Storage migration tests.
- CLI command tests.
- MCP tool tests.
- Connector contract tests.
- Runner dry-run tests.
- Orchestrator workflow tests.
- Policy negative tests.

## 4. CI Requirements

CI should run:

```txt
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 5. Coding Rules

- All durable state must be schema validated.
- All state transitions must go through Core.
- MCP tools must not bypass the policy engine.
- Connectors must not write directly into `.agentmesa/` except through Core.
- Runner output must always be stored as artifacts or logs.
- Dangerous actions must require explicit user approval.

## 6. Release Strategy

Use semver:

- `0.x`: rapid development.
- `1.0`: stable protocol, CLI, MCP, Claude, and Codex integration.
- `1.x`: connector ecosystem and Desk.

## 7. Suggested Initial Implementation Order

1. Create monorepo workspace.
2. Implement protocol package.
3. Implement file storage adapter.
4. Implement core task/message/artifact services.
5. Implement CLI init/task/status commands.
6. Implement Git connector.
7. Implement MCP server.
8. Implement Codex review runner.
9. Implement Claude fix runner.
10. Implement plugin installers.
11. Implement orchestrator.
12. Implement policy hardening.
13. Implement optional Desk.
