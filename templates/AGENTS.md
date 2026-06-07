# AGENTS.md

This project uses AgentMesa for AI agent collaboration.

## AgentMesa Rules

When acting as a reviewer:

1. Find tasks with `status: ready_for_review`.
2. Read the task context, implementation summary, changed files, and git diff.
3. Produce a review report using `templates/review-report.md`.
4. Mark the task as `approved` or `changes_requested`.
5. Do not modify source code unless explicitly assigned as builder.

When acting as a builder:

1. Implement the assigned task.
2. Write an implementation summary.
3. Record changed files and checks run.
4. Request review through AgentMesa.
5. Do not mark a task as done before review approval.
