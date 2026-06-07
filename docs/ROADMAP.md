# AgentMesa Roadmap

## Phase 0: Design

- Define product positioning.
- Define repository structure.
- Draft Mesa Protocol.
- Draft security model.
- Draft connector architecture.

## Phase 1: CLI + File Protocol MVP

Goal: make structured handoff work without a dashboard.

Deliverables:

- `mesa init`
- `.agentmesa/` local directory
- Task YAML schema
- Message JSONL schema
- Artifact templates
- Git diff helper
- Basic task list/status commands

## Phase 2: MCP Server

Goal: let Claude Code and Codex call AgentMesa through shared tools.

Deliverables:

- Mesa MCP server
- mesa_create_task
- mesa_list_tasks
- mesa_read_task
- mesa_request_review
- mesa_submit_review
- mesa_attach_artifact
- mesa_get_git_diff

## Phase 3: Claude + Codex Integration

Goal: prove the first real two-agent loop.

Deliverables:

- Claude Code plugin skeleton
- Codex skill/config skeleton
- AGENTS.md template
- CLAUDE.md template
- codex-review runner
- claude-fix runner

## Phase 4: Orchestration

Goal: automate the review/fix loop safely.

Deliverables:

- Workflow engine
- Max review loop count
- Needs-user-decision state
- Retry and failure handling
- Command allowlist

## Phase 5: Optional Mesa Desk

Goal: visualize meetings and agent state.

Deliverables:

- Task board
- Meeting timeline
- Artifact viewer
- Diff viewer
- Agent configuration page
