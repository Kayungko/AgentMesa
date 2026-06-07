# AgentMesa

**AgentMesa is a plugin-first meeting layer for AI coding agents.**

AgentMesa gives Claude Code, Codex, Cursor, Gemini CLI, and other AI coding agents a shared meeting table where they can hand off tasks, review code, discuss fixes, and synchronize state through a common protocol.

中文定位：

> AgentMesa 是一个插件优先的 AI 编程智能体协作会议层。它让 Claude Code、Codex 等 Agent 围绕同一个任务自动交接、讨论、评审、修复和交付。

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

This repository is currently in the product and architecture design phase.

See:

- [Product Design](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Connectors](docs/CONNECTORS.md)
- [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
