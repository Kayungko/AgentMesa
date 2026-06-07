# AgentMesa Security Model

AgentMesa should be local-first and permission-aware by default.

## Principles

1. Least privilege for every agent.
2. Explicit user confirmation for risky actions.
3. No silent access to secrets.
4. No automatic merge or push in the default configuration.
5. Every action should be logged.

## Permission Levels

```txt
read_only
  Can read task context and diffs.

reviewer
  Can write review artifacts but cannot modify source code.

builder
  Can modify source code in the assigned workspace.

maintainer
  Can run checks and create commits.

owner
  Can approve final delivery, push, merge, or release.
```

## Default Allowed Commands

```txt
git status
git diff
git log
npm test
npm run build
npm run lint
pnpm test
pnpm build
```

## Default Blocked Actions

- Reading SSH keys.
- Reading browser credentials.
- Reading unknown secret files.
- Running unknown remote scripts.
- Deleting large directory trees.
- Automatically pushing to remote.
- Automatically merging to main.
- Modifying production deployment settings without approval.

## Required User Approval

AgentMesa should ask for explicit user approval before:

- Adding production dependencies.
- Deleting many files.
- Modifying authentication, payment, deployment, or secret handling logic.
- Pushing commits.
- Opening or merging pull requests.
- Executing irreversible shell commands.
