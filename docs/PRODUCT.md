# AgentMesa Product Design

> Direction of record: see `COLLAB_VISION.md` for the universal agent
> collaboration layer positioning (2026-08). This document is aligned with it.

## Positioning

AgentMesa is a **local-first universal agent collaboration layer** for AI agents.

Any capable AI agent — CLI agents (Claude Code, Codex, Gemini CLI), GUI/desktop-app
agents (AI Mana, ChatGPT desktop, Claude Desktop, Cursor), or bots — can join the
same room, exchange structured messages under human direction, and produce
auditable, replayable collaboration records.

Coding-agent collaboration (the original meeting layer) remains the flagship
workflow, but it is a proving pair, not the boundary of the product.

## Target Users

- Individual developers using multiple AI agents across different clients (CLI and GUI).
- Small teams experimenting with multi-agent workflows across vendors.
- Engineering teams that need auditable, replayable AI-assisted implementation and review records.

## Core Problem

AI agents are powerful individually, but each lives in its own walled client.
They cannot share one conversation, one task context, or one audit trail.

AgentMesa solves the collaboration gap:

```txt
Builder Agent implements
  -> Reviewer Agent reviews
  -> Builder Agent fixes
  -> Reviewer Agent approves
  -> User decides final delivery
```

## Product Principles

1. Vendor-neutral: the layer belongs to no agent vendor.
2. Local-first by default; files and event logs are the product, not a limitation.
3. Protocol before UI.
4. Existing tools remain the primary workspace; AgentMesa is where they meet.
5. Every agent action should be traceable and replayable.
6. Conversation is free; state mutation requires human confirmation.

## Collaboration Model

The core loop (see `COLLAB_VISION.md` §2):

- The **human** issues instructions, may @mention a specific agent, and makes final calls.
- **Planner/reviewer agents** propose plans and review results.
- **Builder agents** execute, write code, and run commands.
- A **running session** of any agent can be attached to a room as a member and participates through its host's access path.
- Everything lands in an append-only, replayable event log.

## Product Modules

- Mesa Protocol: shared schemas and status lifecycle.
- Mesa Core: local task, message, artifact, and state store.
- Mesa MCP: shared tool interface for AI agents (stdio today; streamable HTTP planned).
- Mesa CLI: init, inspect, and debug workflows.
- Mesa Runner: invokes Claude, Codex, or other agents.
- Mesa Connectors: tool-specific adapters.
- Mesa Desk: local API server embedded in the desktop client (IM-style agent monitor plus tray widget).
- Rooms: cross-workspace, cross-vendor group chat with @mention routing.

## MVP Outcome

The MVP should prove one reliable loop:

```txt
Claude Code writes code -> Codex reviews -> Claude Code fixes -> Codex approves
```

The 1.x outcome extends the same loop to any agent (see `RELEASE_PLAN.md`).
