# @agentmesa/runner

Agent execution layer. Drives a `pending` agent run through its lifecycle
(`pending → running → completed | failed`), builds prompts from Mesa state,
invokes a backend, and persists output as an `agent_run_log` artifact.

## Backends (`RunnerType`)

| RunnerType         | Backend       | Behavior                                            |
| ------------------ | ------------- | --------------------------------------------------- |
| `claude-implement` | `ClaudeRunner`| Spawns the Claude CLI (see *Real CLI invocation*)   |
| `claude-fix`       | `ClaudeRunner`| Spawns the Claude CLI                               |
| `codex-review`     | `CodexRunner` | Spawns the Codex CLI                                |
| `codex-test`       | `CodexRunner` | Spawns the Codex CLI                                |
| `shell-check`      | `ShellRunner` | Runs an allowlisted shell command for real          |
| `document`         | `ClaudeRunner`| (Currently routed to Claude)                        |

Backends are constructed through the stable `createRunner(type, paths, dryRun)`
factory; `resolveRunnerType(run)` maps a run's explicit `runnerType` (or its
`action`) to the backend.

## Execution

```ts
import { executeRun } from '@agentmesa/runner';
await executeRun(ctx, runId, { dryRun?, createArtifacts?, timeout? });
// → { run: MesaAgentRun, result: RunResult }
```

See [`docs/AGENT_RUNS.md`](../../docs/AGENT_RUNS.md) for the full lifecycle,
backend resolution, and artifact-persistence rules.

## Real CLI invocation

`ClaudeRunner` and `CodexRunner` spawn the local AI CLI **only when the
corresponding env var is set**, via the shared shell-free `runCli` helper
(`spawnSync`, prompt on **stdin** so prompts can't inject shell commands;
5-minute default timeout, overridable per run):

| Backend        | Env var                | Example value |
| -------------- | ---------------------- | ------------- |
| `ClaudeRunner` | `AGENTMESA_CLAUDE_CMD` | `claude -p`   |
| `CodexRunner`  | `AGENTMESA_CODEX_CMD`  | `codex exec`  |

The env value is whitespace-split into program + fixed args; for anything more
complex, point it at a wrapper script. A missing binary or non-zero exit marks
the run `failed`. When the env var is **unset**, the runner falls back to a stub
that echoes the constructed prompt as output — so CI and tests run with no CLI
dependency and zero token spend.
