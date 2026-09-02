# AGENTS.md — AgentMesa Contributor & Agent Index

Read this first when working in this repository (as a human contributor or
an AI agent). Generated docs for specific agents (CLAUDE.md etc.) are
produced by `mesa install`; this file is the hand-maintained index.

## What this project is

AgentMesa is a **local-first universal agent collaboration layer**: any AI
agent (CLI or GUI, any vendor) can join the same room and collaborate under
human direction, with every exchange landing in an append-only, replayable
local event log.

- Direction of record: [`docs/COLLAB_VISION.md`](docs/COLLAB_VISION.md)
- Do not regress the positioning to "Claude Code + Codex bridge" — that pair
  is the first proving workflow, not the product boundary.

## Document map

### Direction (read before product decisions)

| Doc | Purpose |
|---|---|
| [docs/COLLAB_VISION.md](docs/COLLAB_VISION.md) | Universal collaboration layer positioning, moat, collaboration model, M1–M4 roadmap. **Supersedes narrower framing in older docs.** |
| [docs/VISION.md](docs/VISION.md) | Long-term vision (any agent joins the same meeting; three integration levels). |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product design, target users, principles, modules. Aligned with COLLAB_VISION. |
| [docs/FULL_PRODUCT_SCOPE.md](docs/FULL_PRODUCT_SCOPE.md) | Complete product scope and success criteria. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Historical phase roadmap (implementation stages). |
| [docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md) | Release staging, including Release 1.1–1.3 (M1–M3) and the 1.x universal-collaboration acceptance scenario. |

### Onboarding (external agents)

| Doc | Purpose |
|---|---|
| [docs/AGENT_ONBOARDING.md](docs/AGENT_ONBOARDING.md) | Single entry guide for external AI agents and their configurators: MCP (stdio/HTTP), CLI, and deep-driving integration levels. |

### Architecture & domain (read before touching code)

| Doc | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture overview. |
| [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) | Canonical entity catalog (16 entities incl. MesaRoom/room messages), invariants, event sourcing. |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Wire protocol, schemas, status lifecycles. |
| [docs/EVENTS.md](docs/EVENTS.md) | Event taxonomy and stream semantics. |
| [docs/STORAGE.md](docs/STORAGE.md) | On-disk layout, atomic writes, locking. |
| [docs/TRANSPORTS.md](docs/TRANSPORTS.md) | Transport layers (file / MCP / HTTP / SSE). |
| [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md) | Workflow engine and review/fix loop. |
| [docs/AGENT_RUNS.md](docs/AGENT_RUNS.md) | Agent run lifecycle and runner behavior. |
| [docs/POLICY_ENGINE.md](docs/POLICY_ENGINE.md) | Roles, capabilities, policy enforcement. |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and security rules. |

### Process & reference

| Doc | Purpose |
|---|---|
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md), [docs/ENGINEERING_PLAN.md](docs/ENGINEERING_PLAN.md) | Development/engineering plans. |
| [docs/IMPLEMENTATION_SCHEDULE.md](docs/IMPLEMENTATION_SCHEDULE.md) | Implementation schedule. |
| [docs/CONNECTORS.md](docs/CONNECTORS.md) | Connector model (git / shell / github). |
| [docs/RUNTIME_CONTEXT.md](docs/RUNTIME_CONTEXT.md) | Runtime context and actor identity. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution rules. |

## Package map

| Package | Responsibility |
|---|---|
| `packages/protocol` | Shared zod schemas, types, status lifecycles. |
| `packages/core` | Services, event store, projections, storage, workspace registry, rooms. |
| `packages/mcp-server` | MCP tool surface for agents (stdio today; HTTP planned — see COLLAB_VISION M3). |
| `packages/runner` | Agent run execution (CLI runners, session runner). |
| `packages/orchestrator` | Workflow engine (review/fix loop). |
| `packages/policy` | Policy engine primitives. |
| `packages/connectors` | git / shell / github adapters. |
| `packages/desk` | Local HTTP API server embedded in the desktop client (REST + SSE). |
| `packages/client` | React UI (IM-style, Notion warm-paper design system). |
| `packages/desktop` | Electron shell (main entry for the app). |
| `packages/cli` | `mesa` CLI. |
| `packages/setup` | Install/integration generation (AGENTS.md, CLAUDE.md, MCP config). |
| `plugins/claude`, `plugins/codex` | Per-vendor plugin generators. |

## Commands

```bash
pnpm build        # build all packages
pnpm test         # run all tests (vitest, per-package)
pnpm typecheck    # typescript across packages
pnpm lint         # lint
pnpm dev          # parallel dev watchers
```

The desktop app starts from `packages/desktop` (root `package.json` has no
`main` entry).

## Conventions

- Docs under `docs/` are written in English; commit messages and in-code
  comments are commonly Chinese — follow the file's existing language.
- Event-sourced core: mutations go through services with a
  `MesaRuntimeContext`; the event log is the source of truth, projections
  are caches. Never write projections directly.
- Every mutation must be policy-checked (`assertPolicy`) — this includes
  room operations (a known gap being fixed in M1; do not add new
  room-surface tools without policy checks).
- Tests live beside source in `__tests__/`; keep vitest suites green before
  reporting a task complete.
- Commit style: `feat(client): <中文描述>` / `fix(core): ...` — match
  `git log`.
