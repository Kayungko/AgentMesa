# AgentMesa Collaboration Vision — Universal Agent Collaboration Layer

Status: **Active direction** (2026-08). This document supersedes the narrower
"Claude Code + Codex bridge" framing found in older downstream docs.
`VISION.md` already stated this goal; this document makes it concrete and
actionable.

## 1. Positioning

AgentMesa is a **local-first universal agent collaboration layer**: any AI
agent — CLI agents (Claude Code, Codex, Gemini CLI), GUI/desktop-app agents
(AI Mana, ChatGPT desktop, Claude Desktop, Cursor), or bots — can join the
same room and collaborate under human direction.

Not an orchestrator. Not a kanban. Not another agent framework. It is the
**meeting bus** between agents that otherwise cannot talk to each other.

### The moat (what we bet on)

| Candidate | Verdict |
|---|---|
| @mention role collaboration | Not differentiating (Slack, Lark, OpenClaw all have it) |
| Vendor-neutral group chat | Partial (cc-connect bridges to IMs, but has no collaboration semantics or audit layer of its own) |
| **Local files + event-sourced replay** | **Real differentiation** — no competitor emphasizes auditability |
| **Cross-vendor live-session attach** | **Strongest wedge** — no cross-vendor product found that pulls *running* agent sessions into one room; the window is closing (Claude Code already does it inside its own ecosystem) |

We bet on the triangle: **cross-vendor + local event-sourced replay +
live-session attach**. We avoid single-point collisions with Claude Code
Agent Teams (own ecosystem) and cc-connect (IM bridge, no semantics).

## 2. Collaboration Model

The core loop is human-directed group collaboration:

```txt
Human   : issues instructions, may @mention a specific agent, makes final calls
Planner : proposes plans, reviews results        (role: planner/reviewer)
Builder : executes, writes code, runs commands   (role: builder)
Room    : the shared, replayable record of everything above
```

### Routing rules

1. **Conversation is free; task creation needs explicit human confirmation.**
   An @mention activates a reply — it does not auto-start work. Work that
   mutates state goes through the existing task → run → approval workflow;
   nothing is written before the first `human_approval` gate.
2. **Roles are declared and enforced.** `MesaAgent.role` (planner/builder/
   reviewer/…) is injected into the agent's system prompt and surfaced in the
   UI as a badge. Planners propose; builders act only on assigned tasks.
3. **Agent-to-agent chatter is bounded.** Consecutive agent↔agent exchanges
   are capped (max turns), collapsed in the UI, and escalate to
   `needs_user_decision` on disagreement.

### Existing sessions join as members

A room member is a **message-level identity**, not a process handle. An
already-running CLI/app session joins by being invited with a member
identity and participating through its host's access path (MCP tools today;
poll + hooks; deeper drivers later). Message delivery to running sessions is
best-effort polling by design — no host supports waking a live process —
so every session-side agent follows the "poll at turn start" convention.

## 3. Access Layers (how any agent gets in)

| Layer | Covers | Status / Priority |
|---|---|---|
| MCP server (stdio) — existing | Claude Code, Codex CLI, any MCP-capable CLI | Done |
| MCP streamable HTTP + remote registration | GUI apps with custom-connector support (ChatGPT dev mode, Claude Desktop, Cursor, Mana-class apps) | P0 next (M3) |
| File protocol (`.agentmesa/`) | Any agent that can read/write files | Done (Level 1) |
| Webhook / event surface | Zero-protocol hosts, external systems | P1 |
| Deep drivers (Codex app-server, Claude Agent SDK, ACP) | Full session-state orchestration (threads, approvals, diffs, resume) | P2 |
| A2A protocol | Remote / cross-org agents | P3 |

Note: OpenAI has deprecated the "Codex as MCP tool-server" surface; full
Codex session control requires the app-server driver — hence the deep-driver
layer is a long-term necessity, not an option.

## 4. Roadmap

### M1 — Message Loop (foundation, unblocks everything)

Blocks identified by the 2026-08 architecture audit that must be repaid here:

- Room messages/membership changes enter the **event stream** (cursor-based
  increment via the reserved `listAfter` interface).
- Room MCP tools go through **`assertPolicy`** (they currently bypass the
  policy engine entirely).
- **Member identity can no longer be spoofed**: `from.ref` must match the
  MCP actor; per-member credentials for external sessions.
- New `mesa_poll_rooms` tool + "poll at turn start" convention injected by
  setup.
- `invite`/`leave` take the existing `withLock`; fix Windows `shell:true` in
  the CLI runner.

### M2 — Collaboration Semantics

- Protocol: `mentions`, `senderRole`, `origin` on room messages; `roles` on
  room members; human as first-class sender.
- UI: @-mention composer (the @ button in `composer.tsx` is currently an
  unwired stub), mention highlighting, role badges, agent-conversation
  collapsing, system-event timeline.
- Room stream gets embedded cards (plan/approval/run) ported from
  MeetingChat.

### M3 — Broad Access

- MCP server gains a transport selection layer (streamable HTTP alongside
  stdio) with **per-connection actor binding** — never a shared env-derived
  actor.
- Remote member registration; local-first isolation rules (default
  127.0.0.1, token required for non-loopback).

### M4 — Deep Orchestration

- Codex app-server / Claude Agent SDK drivers: AgentMesa drives full agent
  sessions instead of only exposing tools.

## 5. Non-Goals

- Not a visual workflow platform (Dify owns that).
- Not a general orchestration framework (LangGraph/CrewAI/AutoGen own that).
- Not a kanban UI (Vibe Kanban owns that; vendors are absorbing it anyway).
- Not cloud-hosted. Local files and the event log are the product, not a
  limitation.
