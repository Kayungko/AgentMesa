# 007 — Smooth status-dot color changes

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: LOW
- **Category**: Cohesion (state changes that teleport)
- **Estimated scope**: 1 file, 3 lines changed

## Problem

Three families of status dots swap color (and glow) instantly when state changes — connection drops, agents go active, the room stream connects. The snap makes state transitions feel like glitches rather than information:

```css
/* packages/client/src/styles.css:39 — current */
.connection__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); }
/* modifiers at :40-42 change background/box-shadow per connection state */

/* packages/client/src/styles.css:492 — current */
.room-live__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--warning); }
/* .room-live--on at :493 switches background + adds glow */

/* packages/client/src/styles.css:691 — current */
.agent-state__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); }
/* .agent-state--active / --ready at :692-694 switch background + add glow */
```

Connection state flips are driven by SSE connect/reconnect (`packages/client/src/useMesaRuntime.ts:84-96`) — visible in the titlebar and statusbar at every disconnect.

## Target

Each dot crossfades color and glow over `var(--motion-base)` (200ms) with the `ease` keyword (color change → `ease`). 200ms is fast enough to feel like the state changed "now", slow enough for the eye to register the change as a transition.

```css
/* target */
.connection__dot { …; transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
.room-live__dot  { …; transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
.agent-state__dot { …; transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
```

## Repo conventions to follow

- `--motion-base` comes from `packages/client/src/styles/tokens.css:147` (already imported first — App.tsx:38-39). Plan 001 establishes the "durations via tokens" convention; follow it.
- Dots are 6-7px; `box-shadow` transitions on elements this small are negligible in cost and keep the glow from snapping, so include them.

## Steps

All in `packages/client/src/styles.css` — append the transition declaration inside each existing one-line rule, keeping all current declarations:

1. Line 39 `.connection__dot`:
   ```css
   .connection__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
   ```
2. Line 492 `.room-live__dot`:
   ```css
   .room-live__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--warning); transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
   ```
3. Line 691 `.agent-state__dot`:
   ```css
   .agent-state__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); transition: background-color var(--motion-base) ease, box-shadow var(--motion-base) ease; }
   ```

## Boundaries

- Do NOT change the dots' colors, sizes, or the modifier rules that switch states.
- Do NOT add transitions to the surrounding labels/text.
- Do NOT touch tokens.css or App.tsx. No new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes.
- **Feel check**: run the UI against the desk server; kill and restart the server (or toggle the network) to force `connected → reconnecting → connected`:
  - the titlebar/statusbar dot crossfades through warning-orange back to green — no hard snap;
  - open a room and watch the live/poll dot crossfade when the stream connects;
  - the transition reads as "the state settled", not as a slow fade — if it feels laggy, it was implemented with a duration longer than 200ms.
- **Done when**: all three dot families crossfade color+glow in ~200ms on state change.
