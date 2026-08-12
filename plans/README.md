# AgentMesa Animation Plans

Written by the `improve-animations` audit on 2026-08-12 at commit `d34b661`.
Scope: `packages/client` (the only frontend surface with motion — React 19 + Vite + plain CSS, no motion libraries). Each plan is fully self-contained: exact file paths, current code, target values, ordered steps, hard boundaries, and a feel-check. Any agent can execute one without reading this README or the audit.

## Plans

| # | Title | Severity | Category | Depends on | Status |
|---|-------|----------|----------|------------|--------|
| 001 | Route all existing transitions through motion tokens | HIGH | Cohesion & tokens | — | DONE |
| 002 | Add press feedback to pressable elements | MEDIUM | Physicality | 001 | DONE |
| 003 | Give workspace popovers an origin-anchored entrance | MEDIUM | Missed opportunity / origin | — | DONE |
| 004 | Entrance animation for live-arriving messages | MEDIUM | Missed opportunity | — | DONE |
| 005 | Entrance animation for arriving approval cards | MEDIUM | Missed opportunity | 004 | DONE |
| 006 | Move the skeleton shimmer onto the compositor | LOW | Performance | — | DONE |
| 007 | Smooth status-dot color changes | LOW | Cohesion | — | DONE |

## Recommended execution order

1. **001** — establishes the "durations via tokens" convention everything else builds on.
2. **002** — edits the same `.agent-pick` / `.room-row` transition lines 001 rewrites; running it second avoids conflicting edits.
3. **003** — independent.
4. **004** — defines `@keyframes msg-in` and the `useFreshMembers` hook.
5. **005** — reuses 004's hook and keyframes; will refuse to run without them (by design).
6. **006** — independent.
7. **007** — independent (consumes the pre-existing `--motion-base` token).

All seven touch `packages/client/src/styles.css` — execute sequentially, not in parallel.

## Shared conventions these plans establish

- Durations come from `tokens.css`: `--motion-fast` (120ms, hover/feedback), `--motion-base` (200ms, entrances/state), never hand-typed ms.
- Deliberate motion (entrances) uses `--ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)`; hover/color keeps the `ease` keyword.
- Press feedback: `scale(0.97)` at 160ms `ease-out` — the one intentional hand-typed duration (the audit's press recipe; no token exists for it).
- Live-arriving content enters via the shared `msg-in` pattern (fade + 4px rise, 200ms) applied only to post-baseline arrivals.
- Every movement animation carries a `prefers-reduced-motion` fallback; opacity/color feedback survives reduced motion.

## Intentionally NOT animated (audit decisions, do not "fix")

- Rail navigation / section switches — high-frequency keyboard-and-click navigation stays instant (frequency rule).
- Widget expand/collapse — it is a native window resize (`packages/desktop/src/main.ts:218-221`, `window.setSize(w, h, true)`; the animate flag is ineffective on Windows). CSS cannot track the window bounds; keep it instant.
- Popover/card exit animations — conditional React unmount; exits stay instant until an exit-retention mechanism exists.
- `pulse`/`shimmer` ambient loop durations (1.6s / 1.4s) — ambient indicators, exempt from the UI duration budget; both already honor reduced motion.

## After execution

Update each plan's **Status** to DONE (with the implementing commit), and run the full check: `pnpm --filter @agentmesa/client typecheck` plus a manual pass of every plan's feel-check list.
