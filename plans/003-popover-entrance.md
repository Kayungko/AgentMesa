# 003 — Give workspace popovers an origin-anchored entrance

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: MEDIUM
- **Category**: Missed opportunity / physicality & origin
- **Estimated scope**: 1 file, ~20 lines added

## Problem

The two floating panels in the titlebar — workspace register and workspace manage — are conditionally rendered in React and appear/disappear instantly, with no motion explaining where they came from:

```css
/* packages/client/src/styles.css:347-361 — current (excerpt) */
.workspace-manage {
  position: absolute;
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 21;
  …
}

/* packages/client/src/styles.css:375-389 — current (excerpt) */
.workspace-register {
  position: absolute;
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  …
}
```

Rendered from `packages/client/src/App.tsx` (`WorkspaceSwitcher`): `workspace-register` at lines 2085-2106 (`{registerOpen ? …}`), `workspace-manage` at lines 2118-2147 (`{manageOpen ? …}`). Both drop down from the titlebar trigger (＋ / ⚙) — a textbook trigger-anchored popover.

## Target

Entrance only (exit stays instant — the components unmount via conditional rendering; exit animations need JS retention and are out of scope here). Fade in from `opacity: 0` while growing from `scale(0.97)`, origin at top center so the panel unfolds from its trigger:

```css
/* target */
.workspace-manage,
.workspace-register {
  transform-origin: 50% 0;
  transition: opacity var(--motion-base) var(--ease-out),
              transform var(--motion-base) var(--ease-out);
}

@starting-style {
  .workspace-manage,
  .workspace-register {
    opacity: 0;
    transform: translateX(-50%) scale(0.97);
  }
}
```

- Duration: `var(--motion-base)` = 200ms (dropdown budget is 150–250ms).
- Easing: `var(--ease-out)` = `cubic-bezier(0.16, 1, 0.3, 1)` (defined in `packages/client/src/styles/tokens.css:145`; entering elements use ease-out).
- Both tokens already exist — do not add new tokens.
- `@starting-style` gives a mount transition with zero JavaScript. If the runtime Chromium is too old to support it (<117), the panel simply appears instantly — the old behavior, graceful fallback.

## Repo conventions to follow

- Keep the existing base `transform: translateX(-50%)` centering in both rules — the starting style composes with it (`translateX(-50%) scale(0.97)` → `translateX(-50%)`).
- Motion tokens come from `styles/tokens.css` (`--motion-base`, `--ease-out`); tokens.css is imported before styles.css in App.tsx:38-39.
- Append the new block near the existing workspace-switcher styles (after line 401, the end of `.workspace-register__actions`) rather than at the very end of the file, keeping sections grouped.

## Steps

All edits in `packages/client/src/styles.css`.

1. Inside the `.workspace-manage { … }` rule (lines 347-361), before the closing `}`, add:
   ```css
   transform-origin: 50% 0;
   transition: opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out);
   ```
2. Inside the `.workspace-register { … }` rule (lines 375-389), add the same two declarations.
3. After the `.workspace-register__actions` rule (~line 401), append:
   ```css
   @starting-style {
     .workspace-manage,
     .workspace-register {
       opacity: 0;
       transform: translateX(-50%) scale(0.97);
     }
   }

   @media (prefers-reduced-motion: reduce) {
     .workspace-manage,
     .workspace-register {
       transition: opacity var(--motion-base) var(--ease-out);
     }
   }
   ```
   The reduced-motion block keeps the opacity fade (aids comprehension) but drops the transform from the transition, so under reduced motion the scale applies instantly (one frame, no perceived movement) while the fade still runs.

## Boundaries

- Do NOT change positioning (`top`, `left`, `z-index`), sizes, colors, shadows, or markup.
- Do NOT add exit animations or JS retention logic — instant close is the accepted tradeoff.
- Do NOT touch App.tsx (no React changes needed). No new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes.
- **Feel check**: run the UI; click ＋ (register workspace) and ⚙ (manage) in the titlebar:
  - the panel unfolds downward from its trigger — visibly from the top edge, not fading in as a whole from center;
  - the animation is quick (~200ms) and never delays typing into the register inputs;
  - closing (cancel / toggle) is instant — that is intended, not a bug;
  - in DevTools Animations panel at 25% playback confirm opacity and transform run together, transform-origin at top center;
  - Rendering panel → emulate `prefers-reduced-motion: reduce`: panel fades without scaling.
- **Done when**: both popovers enter with a 200ms origin-top fade+grow, exit instantly, and reduced motion keeps fade only.
