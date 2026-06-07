# Mesa Protocol

Mesa Protocol is the shared communication format used by AgentMesa agents.

## Goals

- Make agent handoffs explicit.
- Preserve task context.
- Track status transitions.
- Store review and fix artifacts.
- Keep human approval points visible.

## Core Entities

### Meeting

A collaboration session around one or more related tasks.

### Task

The smallest unit of work.

### Agent

A participant in a meeting.

Common roles:

- chair
- planner
- builder
- reviewer
- tester
- documenter

### Message

A structured event exchanged between agents.

### Artifact

A durable output from an agent action, such as a review report or implementation summary.

## Task Status Lifecycle

```txt
todo
  -> in_progress
  -> ready_for_review
  -> reviewing
  -> changes_requested -> in_progress
  -> approved
  -> done
```

Exceptional states:

```txt
blocked
failed
cancelled
conflict
needs_user_decision
```

## Message Types

- task_created
- handoff
- review_request
- review_result
- fix_request
- fix_done
- test_result
- decision
- status_changed

## Example Task

```yaml
id: T-0001
title: Implement QR login
status: ready_for_review
created_by: user
assigned_to: claude
reviewer: codex
repo: AgentMesa
branch: feature/qr-login

context:
  goal: Implement QR login flow.
  changed_files:
    - src/login/QRLoginController.ts
    - src/services/qrLogin.ts
  commands:
    - npm test
    - npm run build
```

## Example Message

```json
{
  "id": "M-0001",
  "task_id": "T-0001",
  "from": "claude",
  "to": "codex",
  "type": "review_request",
  "summary": "Implementation is ready for review.",
  "artifacts": ["implementation-summary.md"]
}
```
