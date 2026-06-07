# AgentMesa Full Product Scope

This document defines the complete product scope. It intentionally goes beyond an MVP.

## 1. Full Product Capabilities

AgentMesa should support the following capability groups.

## 1.1 Agent Meeting Layer

- Create meetings around tasks.
- Invite agents into a meeting.
- Assign roles to agents.
- Preserve all messages and decisions.
- Show current meeting status.
- Support multiple related tasks in one meeting.

## 1.2 Task Handoff

- Create task.
- Assign task.
- Request review.
- Request fix.
- Request test.
- Request documentation.
- Close task after approval.

## 1.3 Structured Agent Messages

- Every agent-to-agent exchange should be recorded as a typed message.
- Message logs should be append-only.
- Messages should link to artifacts and state transitions.

## 1.4 Artifact Management

Artifacts should include:

- Implementation summaries.
- Review reports.
- Fix summaries.
- Test results.
- Git diffs.
- Patches.
- Decision records.
- PR summaries.
- Agent run logs.

## 1.5 Protocol and Schema

- Versioned schemas.
- Runtime validation.
- Migration strategy.
- Strict status transition rules.
- Agent capability declaration.

## 1.6 Local Runtime

- Local project state.
- Optional SQLite index.
- File-based human-readable artifacts.
- Locking.
- Recovery after interrupted runs.

## 1.7 MCP Integration

- MCP server for agents.
- MCP tools for task, review, artifact, and git operations.
- MCP resources for task and meeting views.
- Permission-aware tool execution.

## 1.8 CLI

- Initialize project.
- Install integrations.
- Manage tasks and meetings.
- Run agents.
- Inspect state.
- Run diagnostics.

## 1.9 Agent Connectors

Required connectors:

- Claude Code.
- Codex.
- Git.
- Shell.

Planned connectors:

- Cursor.
- Gemini CLI.
- GitHub.
- CI.

## 1.10 Workflow Orchestration

- Default review/fix loop.
- Multi-agent planning/build/review/test/doc workflow.
- Manual and automatic modes.
- Human approval gates.
- Failure recovery.

## 1.11 Security and Governance

- Permission roles.
- Command allowlist.
- File access policy.
- Secret protection.
- Audit log.
- User confirmation for risky actions.

## 1.12 Optional Visual Monitor

Mesa Desk should provide:

- Meeting timeline.
- Task board.
- Agent status.
- Artifact viewer.
- Diff viewer.
- Policy configuration.

## 2. Full Product User Journeys

## 2.1 Claude Builds, Codex Reviews

```txt
User creates task
Claude implements
AgentMesa saves implementation summary
Codex reviews
Claude fixes
Codex approves
User confirms done
```

## 2.2 Planner, Builder, Reviewer, Tester

```txt
User creates complex feature request
Planner splits work
Builder implements
Reviewer reviews
Tester runs checks
Documenter updates docs
User approves
```

## 2.3 PR Review Bridge

```txt
GitHub PR opened
AgentMesa imports PR diff
Codex reviews
Claude proposes fix
Checks run
User approves merge
```

## 2.4 Manual Agent Meeting

```txt
User opens meeting
User asks Claude and Codex to discuss a design
Both agents write structured messages
User makes final decision
Decision becomes artifact
```

## 3. Required Documentation for Complete Product

- Installation guide.
- Claude setup guide.
- Codex setup guide.
- MCP server guide.
- CLI reference.
- Protocol reference.
- Connector authoring guide.
- Security model.
- Troubleshooting guide.
- Workflow recipes.

## 4. Required Examples

- Claude + Codex review.
- Multi-agent feature workflow.
- GitHub PR review import.
- Manual design discussion.
- Policy-blocked risky command.

## 5. Complete Product Success Criteria

AgentMesa succeeds when:

- Users do not need to manually copy context between Claude and Codex.
- Every handoff is traceable.
- Every review result is stored.
- Every fix has a link to the review that requested it.
- Users can resume interrupted workflows.
- Agents cannot silently exceed their permissions.
- The system can be used without opening a separate desktop app.
