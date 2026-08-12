# 006 — Move the skeleton shimmer onto the compositor

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 1 file, ~20 lines replaced

## Problem

The loading skeleton animates `background-position`, which repaints every frame instead of compositing:

```css
/* packages/client/src/styles.css:175-189 — current */
.skeleton {
  height: 96px;
  border-radius: 15px;
  background: linear-gradient(100deg, rgba(139,124,255,.10) 30%, rgba(139,124,255,.26) 50%, rgba(139,124,255,.10) 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
.skeleton--compact { height: 64px; border-radius: 12px; }
@keyframes shimmer {
  from { background-position: 180% 0; }
  to { background-position: -20% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
```

Skeletons show on every initial load of every view (overview, runs, sessions, deploy, widget — see `SkeletonStack` in `packages/client/src/App.tsx:181-189`). The element is small and short-lived, so this is polish, not a frame-budget crisis — but the fix is a strict improvement at zero visual cost.

## Target

Same look, same 1.4s linear loop (constant motion → `linear` is correct), but the sweep is a `transform: translateX` on a pseudo-element, which composites:

```css
/* target — replaces the whole current block */
.skeleton {
  position: relative;
  overflow: hidden;
  height: 96px;
  border-radius: 15px;
  background: rgba(139, 124, 255, 0.10);
}
.skeleton--compact { height: 64px; border-radius: 12px; }
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, rgba(139, 124, 255, 0.16) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton::after { animation: none; }
}
```

Colors are preserved from the current gradient (base fill `rgba(139,124,255,.10)` = old end stops; sweep peak `rgba(139,124,255,.16)` ≈ old mid stop `.26` minus the now-separate base). Under reduced motion the pseudo-element parks at `translateX(-100%)`, fully clipped by `overflow: hidden`, leaving a flat static placeholder — the intended calm state.

## Repo conventions to follow

- Single flat stylesheet `packages/client/src/styles.css`; replace the block in place (lines 175-189), keeping its position among the loading/empty-state styles.
- The purple tint is the legacy frozen visual language (see tokens.css header) — keep the exact hues, only change the animation mechanism.

## Steps

1. In `packages/client/src/styles.css`, replace the entire block at lines 175-189 (from `.skeleton {` through the `prefers-reduced-motion` block that ends `.skeleton { animation: none; }`) with the target CSS above, verbatim.
2. No other file changes.

## Boundaries

- Do NOT change the hues, the 1.4s duration, or the linear easing.
- Do NOT touch `.skeleton--compact`'s height/radius or `SkeletonStack` in App.tsx.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes. `grep -n "background-position" packages/client/src/styles.css` — expected: no output.
- **Feel check**: run the UI, observe skeletons during initial load (throttle the network in DevTools if loads are too fast to see):
  - the highlight band sweeps left→right at the same speed and with the same colors as before;
  - DevTools → Performance panel while skeletons shimmer: no continuous paint rectangles over the skeleton areas (composited frames only);
  - emulate `prefers-reduced-motion: reduce`: a calm flat placeholder, no sweep.
- **Done when**: visual shimmer is indistinguishable from before, paint activity during shimmer is gone, reduced motion shows a static block.
