# 005 — Entrance animation for arriving approval cards

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: MEDIUM (rare, high-value moment currently rendered with zero delight)
- **Category**: Missed opportunity
- **Estimated scope**: 2 files, ~15 lines added
- **Depends on**: plan 004 (reuses `useFreshMembers`, `@keyframes msg-in`, and the shared reduced-motion block)

## Problem

An approval card is the highest-stakes moment in the app: an agent has stopped working and is waiting for the human's decision ("需要你的决策"). These cards enter the decision queue completely still — they simply exist on the next render:

```tsx
/* packages/client/src/App.tsx:129 — current */
    <article className="approval-card">

/* packages/client/src/App.tsx:300-311 — widget render site (current) */
        {runtime.waiting.length > 0 ? (
          <div className="stack">
            {runtime.waiting.map((workflow) => (
              <ApprovalCard
                key={workflow.workflowId}
                workflow={workflow}
                task={runtime.tasks.find((task) => task.id === workflow.taskId)}
                onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
              />
            ))}
          </div>
        ) : null}

/* packages/client/src/App.tsx:2320-2329 — overview decision queue render site (current) */
                <div className="approval-grid">
                  {runtime.waiting.map((workflow) => (
                    <ApprovalCard
                      key={workflow.workflowId}
                      workflow={workflow}
                      task={runtime.tasks.find((task) => task.id === workflow.taskId)}
                      onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
                    />
                  ))}
                </div>
```

`runtime.waiting` is the subset of workflows with status `waiting_approval` (`packages/client/src/useMesaRuntime.ts:105-108`). Note: a workflow's `startedAt` predates its transition to waiting, so freshness must be tracked by workflow ID (first-seen baseline), not by timestamp — that is exactly what plan 004's `useFreshMembers` hook does.

## Target

A workflow that enters the waiting queue while the user is present gets the same entrance family as live messages: `msg-in` (fade + 4px rise), `var(--motion-base)` = 200ms, `var(--ease-out)`. Initial queue contents on load do not animate. Exit (decision made, card removed) stays instant — unmount animation needs JS retention, out of scope.

```css
/* target — append to packages/client/src/styles.css, next to plan 004's msg-in block */
.approval-card.msg-enter {
  animation: msg-in var(--motion-base) var(--ease-out) both;
}
```

(The `prefers-reduced-motion` block from plan 004 already lists `.approval-card.msg-enter` — do not add a second one.)

## Repo conventions to follow

- Reuse plan 004's `useFreshMembers(scope, ids)` hook verbatim — do not write a second hook.
- All edits to components stay in `packages/client/src/App.tsx`; CSS stays in `packages/client/src/styles.css`.
- The widget and the main window are separate mounts (`view=widget` vs `main`, App.tsx:2410-2413), so give them distinct scope strings: `'widget-approvals'` and `'overview-approvals'`.

## Steps

1. `packages/client/src/styles.css` — append next to plan 004's entrance block:
   ```css
   .approval-card.msg-enter {
     animation: msg-in var(--motion-base) var(--ease-out) both;
   }
   ```
2. `packages/client/src/App.tsx` — `ApprovalCard` signature (lines 103-111): add a `fresh` prop:
   ```tsx
   function ApprovalCard({
     workflow,
     task,
     onDecide,
     fresh = false,
   }: {
     workflow: WorkflowState;
     task?: MesaTask;
     onDecide: (decision: 'approve' | 'reject', message?: string) => Promise<void>;
     fresh?: boolean;
   }) {
   ```
3. Same component, line 129 — add the class:
   ```tsx
   <article className={`approval-card ${fresh ? 'msg-enter' : ''}`}>
   ```
4. `WidgetView` — after `const focusRun = runtime.activeRuns[0];` (line 254) and BEFORE the `if (!expanded)` early return (line 262), add:
   ```tsx
   const freshApprovalIds = useFreshMembers('widget-approvals', runtime.waiting.map((workflow) => workflow.workflowId));
   ```
5. Widget render site (lines 300-311) — pass the flag:
   ```tsx
   fresh={freshApprovalIds.has(workflow.workflowId)}
   ```
   as an additional prop on the `<ApprovalCard … />` inside the widget's `runtime.waiting.map`.
6. `MainView` — next to the other hooks (e.g. after `const [eventFilter, setEventFilter] = useState<EventCategory>('all');` at line 2212; MainView has no early returns, any position among its hooks is safe), add:
   ```tsx
   const freshApprovalIds = useFreshMembers('overview-approvals', runtime.waiting.map((workflow) => workflow.workflowId));
   ```
7. Overview decision-queue render site (lines 2320-2329) — pass the same `fresh={freshApprovalIds.has(workflow.workflowId)} prop on that `<ApprovalCard … />`.

## Boundaries

- Requires plan 004's hook and keyframes to exist. If `useFreshMembers` or `@keyframes msg-in` are missing from the code you find, STOP and report — do not reimplement them differently.
- Do NOT animate cards present at mount (first-seen baseline handles this); do NOT animate card removal.
- Do NOT change ApprovalCard's layout, colors, or copy; className and prop only.
- Do NOT touch tokens.css. No new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes.
- **Feel check**: run the UI; put a workflow into `waiting_approval` while the overview page is open (start a workflow via the API/CLI, or use an existing one transitioning state):
  - the new approval card fades in with the small rise (~200ms) while existing cards stay still;
  - reload the page with approvals already waiting: they appear instantly, no animation;
  - approve/reject: the card disappears instantly (intended);
  - the widget view shows the same behavior for its own queue;
  - emulate `prefers-reduced-motion: reduce`: arrivals appear instantly.
- **Done when**: newly waiting approvals enter with the shared 200ms fade+rise; the initial queue never animates.
