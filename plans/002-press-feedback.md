# 002 — Add press feedback to pressable elements

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, ~45 lines added/edited

## Problem

There is not a single `:active` rule in the entire client stylesheet. Every pressable surface — buttons, icon buttons, rail nav, cards, chips, list rows — gives zero tactile response when clicked. The press is the most frequent physical interaction in the app and it currently lands on stone.

Pressable elements verified without press feedback (all in `packages/client/src/styles.css`):

```css
/* :163 */ .button { min-height: 34px; padding: 0 12px; border-radius: 10px; cursor: pointer; }
/* :106 */ .icon-button { … cursor: pointer; }
/* :211 */ .rail button { … cursor: pointer; … }
/* :228 */ .workflow-list button { … cursor: pointer; }
/* :326 */ .workspace-switcher__add { … cursor: pointer; … }
/* :340 */ .workspace-switcher__manage { … cursor: pointer; }
/* :55  */ .widget-summary { … cursor: pointer; }
/* :673 */ .agent-pick { … cursor: pointer; … transition: border-color …, background …; }
/* :462 */ .room-row { … cursor: pointer; … transition: border-color …, background …; }
/* :120 */ .run-card { … cursor: pointer; … transition: … transform …; }
/* :601 */ .session-card { … cursor: pointer; … transition: … transform …; }
```

## Target

The audit recipe: `transform: scale(0.97)` on `:active` with `transition: transform 160ms ease-out`. Cards that lift on hover (`translateY(-1px)`) settle back down and compress slightly: `translateY(0) scale(0.98)`. Sub-20px remove (×) controls use `scale(0.9)` because 0.97 is invisible at that size.

```css
/* target press states */
.button:active, .icon-button:active, .widget-summary:active,
.rail button:active, .workflow-list button:active,
.workspace-switcher__add:active, .workspace-switcher__manage:active,
.agent-pick:active, .room-row:active          { transform: scale(0.97); }

.run-card:active, .session-card:active        { transform: translateY(0) scale(0.98); }

.workspace-manage__remove:active, .room-member__remove:active,
.agent-card__remove:active                    { transform: scale(0.9); }
```

## Repo conventions to follow

- All component styles live flat in `packages/client/src/styles.css`, grouped in commented sections (`/* --- Rooms ... --- */` etc.). Append a new commented section; do not create a new CSS file.
- Run plan 001 first: it tokenizes the existing transitions on `.agent-pick` / `.room-row` / `.run-card` / `.session-card` that this plan extends.
- Press feedback is state feedback, not decorative motion — it is intentionally NOT disabled under `prefers-reduced-motion` (a 3% scale on press is a static position change the user caused, not autonomous movement).

## Steps

All edits in `packages/client/src/styles.css`.

1. Extend the existing transition of `.agent-pick` (after plan 001 it reads `transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease;`) to:
   ```css
   transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease, transform 160ms ease-out;
   ```
2. Apply the identical change to `.room-row` (same current line).
3. Append a new section at the end of the file:
   ```css
   /* --- Press feedback (plan 002) --- */
   .button,
   .icon-button,
   .widget-summary,
   .rail button,
   .workflow-list button,
   .workspace-switcher__add,
   .workspace-switcher__manage {
     transition: transform 160ms ease-out;
   }
   .workspace-manage__remove,
   .room-member__remove,
   .agent-card__remove {
     transition: transform 160ms ease-out;
   }
   .button:active,
   .icon-button:active,
   .widget-summary:active,
   .rail button:active,
   .workflow-list button:active,
   .workspace-switcher__add:active,
   .workspace-switcher__manage:active,
   .agent-pick:active,
   .room-row:active {
     transform: scale(0.97);
   }
   .run-card:active,
   .session-card:active {
     transform: translateY(0) scale(0.98);
   }
   .workspace-manage__remove:active,
   .room-member__remove:active,
   .agent-card__remove:active {
     transform: scale(0.9);
   }
   ```
   The block must stay at the end of the file: `.run-card:active` has the same specificity as `.run-card:hover`, so file order decides — `:active` after `:hover` wins while pressed.

## Boundaries

- Do NOT add press scaling to `.event-filter` chips (their `--active` state color change on toggle is the feedback) or to `.window-controls button` (OS window chrome mimic; hover color only, like Windows titlebars).
- Do NOT add press effects to `<select>` elements (`.task-status-select`, `.workspace-switcher__select`) — native controls.
- Do NOT change hover styles, colors, radii, or markup. Motion properties only.
- Do NOT touch App.tsx or tokens.css. No new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes. `grep -n ":active" packages/client/src/styles.css` shows the new block and nothing else.
- **Feel check**: run the UI; press and HOLD a primary button, a rail icon, a session card, an agent-pick chip, a room row, and a × remove control:
  - each compresses subtly while held and springs back on release (~160ms, no snap);
  - holding a run/session card pushes it back down from its hover lift — it should feel pushed, not flicker between lifted and pressed;
  - in DevTools Rendering panel enable "paint flashing": pressing paints nothing new (transform only).
- **Done when**: every element listed in the target block visibly compresses while pressed, and no hover style changed.
