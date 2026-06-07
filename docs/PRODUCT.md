# AgentMesa Product Design

## Positioning

AgentMesa is a plugin-first meeting layer for AI coding agents.

It gives multiple AI coding tools a shared meeting table where they can exchange structured task context, review results, fix requests, and delivery state.

## Target Users

- Individual developers using multiple AI coding tools.
- Small teams experimenting with Claude Code, Codex, Cursor, Gemini CLI, or other coding agents.
- Engineering teams that need auditable AI-assisted implementation and review workflows.

## Core Problem

AI coding tools are powerful individually, but they do not naturally collaborate with each other.

AgentMesa solves the handoff gap:

```txt
Builder Agent implements
  -> Reviewer Agent reviews
  -> Builder Agent fixes
  -> Reviewer Agent approves
  -> User decides final delivery
```

## Product Principles

1. Plugin-first, not IDE-first.
2. Local-first by default.
3. Protocol before UI.
4. Existing tools remain the primary workspace.
5. Every agent action should be traceable.
6. User approval is required for high-risk actions.

## Product Modules

- Mesa Protocol: shared schemas and status lifecycle.
- Mesa Core: local task, message, artifact, and state store.
- Mesa MCP: shared tool interface for AI agents.
- Mesa CLI: init, inspect, and debug workflows.
- Mesa Runner: invokes Claude, Codex, or other agents.
- Mesa Connectors: tool-specific adapters.
- Mesa Desk: optional future visual monitor.

## MVP Outcome

The MVP should prove one reliable loop:

```txt
Claude Code writes code -> Codex reviews -> Claude Code fixes -> Codex approves
```
