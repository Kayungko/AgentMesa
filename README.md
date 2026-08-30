# AgentMesa

**AgentMesa is a local-first universal agent collaboration layer.**

Any capable AI agent — CLI (Claude Code, Codex, Gemini CLI) or GUI/desktop (AI Mana, ChatGPT desktop, Claude Desktop, Cursor) — can join the same room, exchange structured messages under human direction, and produce auditable, replayable collaboration records. Coding-agent collaboration remains the flagship workflow, but it is a proving pair, not the product boundary.

中文定位：

> AgentMesa 是一个本地优先的通用 AI 智能体协作层。任何 Agent——CLI 的 Claude Code、Codex、Gemini CLI，或 GUI/App 内置的智能体——都能进入同一个群聊，在人的指挥下协作，全程留下可审计、可回放的本地事件记录。

## Vision

AgentMesa is not only a Claude Code + Codex bridge. Claude and Codex are the first proving pair.

The long-term goal is broader:

> Any capable AI agent should be able to join the same project meeting, understand shared task context, exchange structured messages, produce artifacts, and continue the workflow from its own client.

See [Collaboration Vision](docs/COLLAB_VISION.md) (direction of record) and [Vision](docs/VISION.md).

## Why AgentMesa

When using multiple AI coding tools today, the handoff is mostly manual:

- Claude Code implements something, but Codex does not know what changed.
- Codex reviews something, but Claude Code does not know what to fix next.
- The user has to copy context, summarize changes, switch tools, and maintain task documents manually.

AgentMesa turns that manual handoff into a structured local workflow.

## Core Idea

```txt
Claude Code / Builder
        │
        │ Mesa Protocol + MCP
        ▼
┌──────────────────────┐
│     AgentMesa Core   │
│ tasks / messages /   │
│ artifacts / state    │
└──────────────────────┘
        ▲
        │ Mesa Protocol + MCP
        │
Codex / Reviewer
```

AgentMesa is not designed to replace existing AI coding tools. It is designed to connect them.

## Product Shape

AgentMesa is designed as a plugin-first system:

- **Mesa Protocol**: task, message, artifact, meeting, status schema.
- **Mesa Core**: local state, task bus, artifact store.
- **Mesa MCP Server**: shared tool interface for Claude Code, Codex, and other agents.
- **Mesa CLI**: initialization, debugging, task management.
- **Mesa Connectors**: Claude, Codex, Git, Shell, and future integrations.
- **Mesa Desk**: optional future visual monitor, not the first primary entry point.

## Repository Structure

```txt
AgentMesa/
  docs/
    VISION.md
    PRODUCT.md
    ARCHITECTURE.md
    PROTOCOL.md
    CONNECTORS.md
    SECURITY.md
    ROADMAP.md
  packages/
    protocol/
    core/
    cli/
    mcp-server/
    runner/
    connectors/
  plugins/
    claude/
    codex/
  templates/
    AGENTS.md
    CLAUDE.md
    implementation-summary.md
    review-report.md
  examples/
    claude-codex-review/
  .agentmesa.example/
```

## MVP Workflow

```txt
User creates task
  ↓
Claude Code implements
  ↓
AgentMesa records implementation summary and git diff
  ↓
Codex reviews
  ↓
If changes are requested, Claude Code fixes
  ↓
Codex re-reviews
  ↓
User approves and marks done
```

## Early CLI Sketch

```bash
mesa init
mesa task create "Implement QR login"
mesa handoff T-0001 --from claude --to codex --type review_request
mesa run codex-review T-0001
mesa run claude-fix T-0001
mesa status T-0001
```

## Status

AgentMesa is **feature-complete for the 0.1.0 release**. All phases 0-14 of development are done.

- ✅ **Phase 0**: Design and Scope — product positioning, architecture, protocol, security model
- ✅ **Phase 1**: Engineering Foundation — TypeScript monorepo, pnpm, CI, build system
- ✅ **Phase 2**: Mesa Protocol — complete types, zod schemas, status lifecycle, fixtures (53 tests)
- ✅ **Phase 3**: Mesa Core — workspace manager, task/meeting/message/artifact services, agent registry, locking (49 tests)
- ✅ **Phase 4**: Mesa CLI — init, doctor, task/message/artifact/meeting/agent commands, JSON output (16 tests)
- ✅ **Phase 5**: Git/Shell Connectors — git status/diff/log/branch, shell allowlist/runner (32 tests)
- ✅ **Phase 6**: Mesa MCP Server — JSON-RPC transport, tool/resource handlers, agent integration (26 tests)
- ✅ **Phase 7**: Mesa Runner — pluggable runners, prompt builders, output parsers, runner factory (32 tests)
- ✅ **Phase 8**: Claude Code Plugin — CLAUDE.md generator, skills, hooks, MCP config, install orchestrator (19 tests)
- ✅ **Phase 9**: Codex Skill/Plugin — AGENTS.md generator, review skill, review report template, MCP config, exec flow (32 tests)
- ✅ **Phase 10**: Orchestrator — workflow engine, review/fix loop, multi-agent workflows, approval gates, resume/failure (27 tests)
- ✅ **Phase 11**: Policy Engine — role capabilities, file access policy, command policy, secret protection, confirmation gates (64 tests)
- ✅ **Phase 12**: GitHub/CI Integrations — PR linking, diff import, review export, CI import, discussion import (12 tests)
- ✅ **Phase 13**: Mesa Desk — task board, meeting timeline, artifact viewer, diff viewer, agent status, policy settings (14 tests)
- ✅ **Phase 14**: Packaging and 1.0 Release — npm packages, CLI binary, plugin packages, docs, examples

**376 tests** across 13 packages, all passing. Typecheck and build clean.

**Next up**: Preparing for 1.0 stable release.

### Package Inventory

| Package | Description |
|---|---|
| `@agentmesa/protocol` | Mesa Protocol types, zod schemas, status lifecycle, fixtures |
| `@agentmesa/core` | Workspace manager, task/meeting/message/artifact services, storage, locking |
| `@agentmesa/cli` | CLI with init, doctor, task/message/artifact/meeting/agent commands |
| `@agentmesa/connector-git` | Git status, diff, log, branch, changed files connector |
| `@agentmesa/connector-shell` | Command allowlist, safe execution, output capture connector |
| `@agentmesa/connector-github` | PR linking, diff import, review export, CI import connector |
| `@agentmesa/mcp-server` | MCP server with JSON-RPC transport, tool and resource handlers |
| `@agentmesa/runner` | Pluggable agent runners, prompt builders, output parsers |
| `@agentmesa/orchestrator` | Workflow engine, review/fix loop, multi-agent workflows, approval gates |
| `@agentmesa/policy` | Role capabilities, file access policy, command policy, secret protection |
| `@agentmesa/desk` | Visual monitor with task board, meeting timeline, artifact/diff viewer |
| `@agentmesa/plugin-claude` | Claude Code plugin with CLAUDE.md, skills, hooks, MCP config generators |
| `@agentmesa/plugin-codex` | Codex plugin with AGENTS.md, review skill, report template generators |

See:

- [Collaboration Vision](docs/COLLAB_VISION.md) — direction of record
- [Vision](docs/VISION.md)
- [Product Design](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Connectors](docs/CONNECTORS.md)
- [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
