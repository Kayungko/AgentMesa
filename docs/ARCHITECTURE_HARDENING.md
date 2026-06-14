# AgentMesa Architecture Hardening Notes

This document records the next architecture hardening work for the complete AgentMesa product.

## Product Standard

AgentMesa is not a small bridge between Claude Code and Codex.

AgentMesa is a universal cross-client meeting layer for AI coding agents. Claude Code and Codex are only the first proving pair.

All local AI work should follow the complete product target.

## Required Architecture Boundaries

The next development stage should stabilize these boundaries before adding more integrations:

```txt
Protocol Boundary
Runtime Boundary
Transport Boundary
Storage Boundary
Policy Boundary
Workflow Boundary
```

## Target Architecture

The final architecture should be organized as:

```txt
Agent Clients
  Claude Code / Codex / Cursor / Gemini / GitHub / CI
        ↓
Mesa Connectors
        ↓
Mesa Transport Layer
  File / MCP / HTTP / WebSocket / GitHub / CI
        ↓
Mesa Runtime
  Core / Storage / Events / Policy / Workflow
        ↓
Mesa Protocol
  Meeting / Task / Message / Artifact / Event / Decision
```

## Main Finding

MCP should not be treated as the center of the system. MCP is one transport adapter.

The center of AgentMesa should be:

```txt
Mesa Protocol + Mesa Runtime + Event-backed local state
```

## Immediate Architecture Tasks

1. Add a formal domain model document.
2. Add a runtime context document.
3. Add a transport layer document.
4. Add an event model document.
5. Add a storage model document.
6. Add a policy model document.
7. Update `ARCHITECTURE.md` to reflect the final layered architecture.

## Transport Boundary (v0.8)

The Transport Layer now has:

- **Protocol-level envelope schema** (`TransportEnvelopeSchema`): id, direction (inbound/outbound), status (pending/processed/failed), payload, correlationId, replyTo. Schema-validated on every write.
- **Inbox/outbox pattern**: `.agentmesa/inbox/` and `.agentmesa/outbox/` directories for async message passing between transports using atomic writes.
- **Transport Registry**: `registerTransport/listTransports/getTransport/inspectTransport` with `transport.inspect` policy enforcement.
- **MCPTransport skeleton**: Declares MCP capabilities, `isAvailable()` returns false until full MCP lifecycle integration.
- **CLI inspection**: `mesa transports list/inspect/inbox/outbox` with `--json` support.

Deferred: HTTP, WebSocket, GitHub, CI transports. Runner, Desk, Plugins still deferred per Do Not Start Yet.

## Stop Rule

Do not continue directly into more client-specific integrations until the runtime and protocol boundaries are stable.
