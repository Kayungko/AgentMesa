# AgentMesa Vision

AgentMesa's long-term goal is to let AI agents communicate and collaborate across their own native clients.

AgentMesa is not only a Claude Code + Codex bridge. Claude and Codex are the first proving pair.

The real product vision is broader:

> Any capable AI agent should be able to join the same project meeting, understand shared task context, exchange structured messages, produce artifacts, and continue the workflow from its own client.

## Core Vision

```txt
Claude Code Desktop
        │
        │
Codex Desktop / CLI
        │
        │
Cursor Agent
        │
        │
Gemini CLI
        │
        │
Other AI coding agents
        │
        ▼
┌──────────────────────────────┐
│          AgentMesa            │
│  shared meetings / tasks /    │
│  messages / artifacts / state │
└──────────────────────────────┘
```

Each agent keeps its own client, UI, model, workflow, and strengths. AgentMesa provides the shared meeting layer between them.

## What Cross-Client Communication Means

Cross-client communication means:

- Claude Code can create a task that Codex can review.
- Codex can leave review feedback that Claude Code can read and fix.
- Cursor can join the same task and propose an alternative implementation.
- Gemini CLI can act as a researcher or tester.
- A GitHub PR bot can import review comments as AgentMesa messages.
- A CI connector can publish test results as check artifacts.
- The user can see and control the whole flow through CLI or optional Desk.

The agents do not need to share the same UI. They only need to share the same protocol, state, and permissions.

## Product Boundary

AgentMesa should not become a replacement for every agent client.

AgentMesa should become the collaboration layer that sits between them:

```txt
Agent Client = where the agent thinks and acts
AgentMesa    = where agents meet and coordinate
Project Repo = where code and artifacts live
```

## Universal Agent Meeting Layer

AgentMesa should support three levels of integration.

### Level 1: File Protocol Integration

Any agent that can read and write project files can participate through `.agentmesa/`.

This is the lowest-friction integration path.

### Level 2: MCP Integration

Any agent client that supports MCP can use Mesa MCP tools directly.

This is the preferred integration path for capable coding agents.

### Level 3: Native Connector / Plugin

For important clients, AgentMesa can provide dedicated integrations:

- Claude Code plugin.
- Codex skill/plugin/config.
- Cursor extension.
- Gemini connector.
- GitHub connector.
- CI connector.

Native connectors provide the best user experience, but the protocol should not depend on them.

## Design Implications

Because the target is all agents across clients, AgentMesa must be designed around stable abstractions:

- Agent, not Claude-specific objects.
- Client, not one UI.
- Meeting, not one chat thread.
- Task, not one prompt.
- Artifact, not only markdown text.
- Connector, not hardcoded CLI calls.
- Capability, not fixed roles.
- Policy, not unlimited tool access.

## First Proving Workflow

The first complete workflow should still be Claude Code + Codex:

```txt
Claude Code implements
  -> AgentMesa records implementation summary and diff
  -> Codex reviews
  -> AgentMesa records review report
  -> Claude Code fixes
  -> Codex approves
  -> User decides final delivery
```

This workflow proves the architecture. It should not limit the product direction.

## Long-Term Outcome

AgentMesa succeeds when AI agents can work like a multi-agent development team:

```txt
Planner Agent
  -> Builder Agent
  -> Reviewer Agent
  -> Tester Agent
  -> Documenter Agent
  -> User Chair
```

Each participant can run in a different client, but all participants share the same meeting state and protocol.
