# Orchestrator

The orchestrator coordinates multi-step agent work. A **workflow** is a graph of
typed steps; the `WorkflowEngine` executes one step at a time, dispatching agent
runs (via `executeRun`), updating task status, evaluating checks, and pausing for
human approval. State is persisted so a workflow can be resumed across processes.

## Workflow Model

```
WorkflowDefinition {
  id:          string
  name:        string
  description: string
  startStep:   string
  steps:       WorkflowStep[]
}

WorkflowStep {
  id:           string
  type:         'update_status' | 'run_agent' | 'check' | 'human_approval' | 'wait'
  description:  string
  onSuccess:    string                 // next step id, or '__end__'
  onFailure?:   string | 'abort'       // next step id, or abort the workflow
  statusUpdate?: TaskStatus            // for update_status
  runnerType?:  string                 // for run_agent (a RunAction: implement|review|fix|...)
  agentId?:     string                 // for run_agent
  condition?:   (ctx: WorkflowContext) => boolean   // for check
}

WorkflowContext { taskId; workflowId; reviewCycles?; approved?; changesRequested?; metadata? }
```

The terminal step id is the sentinel `__end__`.

## State

```
WorkflowState {
  workflowId:           string
  workflowDefinitionId: string
  currentStep:          string
  status:               'running' | 'paused' | 'completed' | 'failed' | 'waiting_approval'
  taskId:               string
  history:              StepExecution[]
  context:              WorkflowContext
  startedAt; completedAt?; pausedAt?; resumedAt?
}
```

State is written to `<workspace>/.agentmesa/logs/workflows/<workflowId>.json` on
every mutation, and cached in-memory by the engine.

## Definition Registry

`WorkflowState` persists only `workflowDefinitionId` (a string). Definitions carry
`condition` closures that cannot survive a JSON round-trip, so the engine resolves
the live definition through a registry rather than reloading it from state:

```ts
registerWorkflow(id, factory)          // register a () => WorkflowDefinition
getWorkflowDefinition(id)              // throws VALIDATION_ERROR if unknown
listWorkflowDefinitionIds()
```

Built-ins are pre-registered: `review-fix-loop` and `full-task-workflow`.

## Engine API

```ts
const engine = new WorkflowEngine(ctx);          // ctx: MesaRuntimeContext

engine.startWorkflow(definition, taskId)         // → WorkflowState (running)
await engine.executeStep(state)                  // execute the current step once
await engine.advanceWorkflow(state, { maxSteps }) // auto-run to terminal/blocked
engine.approve(state)                            // resume from waiting_approval
engine.reject(state, reason)                     // abort from waiting_approval
engine.pause(state) / engine.resume(state)
engine.abort(state, reason)
engine.getState(workflowId)                      // cache → file fallback
```

### Step execution (`executeStep`)

| Step type        | Behavior                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `update_status`  | Idempotent + tolerant: skip if the task is already in the target status; apply only when the transition is valid; otherwise record a skip and continue (never fails the workflow). |
| `run_agent`      | `createAgentRun` (with `action = step.runnerType`) then `executeRun`. On `completed` → `onSuccess`; on `failed`/thrown → `onFailure` (`'abort'` ends the workflow). |
| `check`          | Evaluate `condition(context)`. True → `onSuccess`. False → increment `context.reviewCycles`, then `onFailure`. |
| `human_approval` | Park the workflow at `waiting_approval` (no auto-advance); resumed by `approve`/`reject`.   |
| `wait`           | No-op pass-through → `onSuccess`.                                                            |

### Driver (`advanceWorkflow`)

Loops `executeStep` while the workflow is `running` and not at `__end__`, bounded by
`maxSteps` (default 50). It returns on `completed`, `failed`, `waiting_approval`, or
when the cap is hit (which aborts). The cap plus a workflow's own cycle guard make
non-termination impossible.

## Review verdict: deterministic loop + count guard

The engine does **not** parse review verdicts from runner output yet. A completed
reviewer run simply re-enters the `check` step. `context.approved` is set only
externally (by `human_approval` via `approve()`, or a future plugin). The
`review-fix-loop`'s check condition is `approved === true || reviewCycles >= 3`, so
after three review cycles the loop routes to human approval regardless. Real
verdict parsing is deferred to the plugin milestone.

## CLI

```bash
mesa workflow start <taskId> [--definition <id>]   # start + auto-advance; default review-fix-loop
mesa workflow status <workflowId>                  # status, current step, history
mesa workflow approve <workflowId>                 # approve a waiting_approval workflow, then advance
mesa workflow run <workflowId>                     # advance a running workflow
```

All commands support `--json`. The CLI runs workflows as the actor
`{ id: 'system:orchestrator', type: 'system', roles: ['owner'] }` so the
`task.updateStatus` and `manage_runs` policy gates pass.

## Built-in: review-fix-loop

`in_progress → implement (builder) → ready_for_review → review (reviewer) → check`;
the check loops back to implement until `reviewCycles >= 3`, then routes to
`human_approval`, and finally `done`.

> **Status-transition caveat.** `update_status` is tolerant, and the loop's status
> sequence does not follow the task state machine exactly (`ready_for_review → done`
> is not a valid transition). The final `done` update is therefore skipped: the
> workflow completes, but the task stays at `ready_for_review`. Reaching `done`
> properly (`ready_for_review → reviewing → approved → done`) is left to a future
> refinement of the workflow definition.

## Current Status

Stage A.2 (Orchestrator): `WorkflowEngine` step execution, the `advanceWorkflow`
driver, `approve`/`reject`, the definition registry, and the `mesa workflow` CLI —
**in progress / functional**. Real review-verdict parsing is deferred to the plugin
milestone.
