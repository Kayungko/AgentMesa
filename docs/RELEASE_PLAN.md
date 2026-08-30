# AgentMesa Release Plan

The product target is complete AgentMesa, not a minimal MVP. Releases should still be staged to reduce risk.

## Release 0.1: Foundation

- Monorepo setup.
- Protocol package.
- Core file storage.
- CLI init/task/status.
- Basic docs.

## Release 0.2: Local Task Bus

- Meeting model.
- Message log.
- Artifact system.
- Status lifecycle enforcement.
- Locking.
- Git connector read-only operations.

## Release 0.3: MCP Server

- MCP server package.
- Core task tools.
- Review request and review submit tools.
- Git diff tools.
- MCP resource URIs.

## Release 0.4: Agent Runners

- Runner abstraction.
- Codex review runner.
- Claude fix runner.
- Prompt templates.
- Output artifact parsing.
- Dry-run mode.

## Release 0.5: Claude and Codex Integration

- Claude plugin skeleton.
- Codex skill/config skeleton.
- Install commands.
- AGENTS.md and CLAUDE.md generation.
- End-to-end Claude/Codex review loop.

## Release 0.6: Orchestration

- Workflow engine.
- Default review/fix workflow.
- Manual and auto modes.
- Human decision gate.
- Retry and failure handling.

## Release 0.7: Policy Engine

- Permission roles.
- Command allowlist.
- File access policy.
- Sensitive path protection.
- Audit logs.

## Release 0.8: GitHub and CI

- GitHub connector.
- PR linking.
- PR artifact export.
- CI status import.

## Release 0.9: Mesa Desk Preview

- Local web monitor.
- Meeting timeline.
- Task board.
- Artifact viewer.
- Diff viewer.

## Release 1.0: Complete Plugin-First Product

1. Stable Mesa Protocol.
2. Stable Mesa Core.
3. Stable CLI.
4. Stable MCP server.
5. Claude Code plugin.
6. Codex skill/config/plugin.
7. Runner and orchestrator.
8. Policy engine.
9. Git/Shell connectors.
10. Documentation and examples.
11. Optional Desk preview.

## 1.0 Acceptance Scenario

A user should be able to run:

```bash
mesa init
mesa install claude
mesa install codex
mesa serve
```

Then use Claude and Codex to complete this full workflow:

```txt
Claude implements a task.
Claude requests Codex review through AgentMesa.
Codex reviews the task and writes structured feedback.
Claude fixes the feedback.
Codex approves.
Tests are run.
User approves delivery.
```

## Release 1.1: Room Message Loop (M1)

Direction reference: `COLLAB_VISION.md` §4 M1. Repays the architecture-audit
blockers and makes cross-session rooms a mechanism instead of a manual
convention:

- Room messages and membership changes enter the event stream with cursor
  increment (`listAfter`).
- Room MCP tools go through `assertPolicy` (no more policy bypass).
- Member identity anti-spoofing: `from.ref` must match the MCP actor;
  per-member credentials.
- New `mesa_poll_rooms` tool + "poll at turn start" convention in generated
  CLAUDE.md / AGENTS.md.
- Room `invite`/`leave` under `withLock`; CLI runner Windows `shell:true`
  fix.

## Release 1.2: Collaboration Semantics (M2)

- Protocol: `mentions`, `senderRole`, `origin` on room messages; `roles` on
  room members; human as a first-class sender.
- Desk UI: @-mention composer, mention highlighting, role badges, embedded
  plan/approval/run cards in the room stream, agent-conversation collapsing,
  system-event timeline.

## Release 1.3: Broad Access (M3)

- MCP server transport selection layer: streamable HTTP alongside stdio.
- Per-connection actor binding (never a shared env-derived actor).
- Remote member registration; loopback-by-default binding, token required
  for non-loopback.

## 1.x Acceptance Scenario (universal collaboration)

In Mesa Desk, a user should be able to:

```txt
Create a room.
Invite a running Claude Code session, a Codex session, and a GUI agent
  (joined via MCP connector) as members.
@mention the planner agent with a requirement.
Planner proposes a plan as an embedded card.
User confirms; a task is created and assigned to a builder agent.
Builder runs; run status streams back into the room.
Reviewer agent posts structured feedback; user makes the final call.
The entire exchange replays from the local event log.
```
