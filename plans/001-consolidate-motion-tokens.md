# 001 — Route all existing transitions through motion tokens

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: HIGH
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file, 5 lines changed

## Problem

`packages/client/src/styles/tokens.css:143-148` defines a complete motion token set:

```css
/* packages/client/src/styles/tokens.css:143-148 — current */
  /* 动效（Apple 标准曲线 + 指数出） */
  --ease-standard: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-fast: 120ms;
  --motion-base: 200ms;
  --motion-slow: 320ms;
```

Zero rules consume it. Every transition in the app is hand-typed in `packages/client/src/styles.css`, with two slightly different durations (120ms and 140ms) for the exact same hover pattern:

```css
/* packages/client/src/styles.css:132 (.run-card) — current */
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;

/* packages/client/src/styles.css:244 (.event-filter) — current */
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;

/* packages/client/src/styles.css:471 (.room-row) — current */
  transition: border-color 120ms ease, background 120ms ease;

/* packages/client/src/styles.css:612 (.session-card) — current */
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;

/* packages/client/src/styles.css:684 (.agent-pick) — current */
  transition: border-color 120ms ease, background 120ms ease;
```

The codebase is mid-migration to a new chat shell (see the DIRECTION CONTRACT comment at the top of tokens.css). New components written during that migration will copy whichever habit they see — tokens now, or hand-typed durations forever.

## Target

All five transitions consume `var(--motion-fast)` (= 120ms, within the 100–160ms hover/feedback budget). The easing keyword stays `ease` — that is the correct easing for hover/color changes; the tokens' strong curves (`--ease-out`) are reserved for deliberate motion like entrances (added by later plans).

```css
/* target */
.run-card   { transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease, transform var(--motion-fast) ease; }
.event-filter { transition: color var(--motion-fast) ease, border-color var(--motion-fast) ease, background var(--motion-fast) ease; }
.room-row   { transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease; }
.session-card { transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease, transform var(--motion-fast) ease; }
.agent-pick { transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease; }
```

## Repo conventions to follow

- Tokens live in `packages/client/src/styles/tokens.css`; `tokens.css` is imported before `styles.css` in `packages/client/src/App.tsx:38-39`, so `var(--motion-fast)` resolves everywhere in styles.css.
- styles.css is the legacy layer (its header comment says old components depend on frozen legacy variables). Do not "modernize" colors or layout here — this plan swaps durations only.

## Steps

1. In `packages/client/src/styles.css` line 132 (inside `.run-card`), replace the transition line with:
   ```css
   transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease, transform var(--motion-fast) ease;
   ```
2. Line 612 (inside `.session-card`) contains the exact same string as step 1 — apply the same replacement there (the old string occurs exactly twice in the file; replace both).
3. Line 244 (inside `.event-filter`), replace with:
   ```css
   transition: color var(--motion-fast) ease, border-color var(--motion-fast) ease, background var(--motion-fast) ease;
   ```
4. Lines 471 (`.room-row`) and 684 (`.agent-pick`) both contain `transition: border-color 120ms ease, background 120ms ease;` — replace both occurrences with:
   ```css
   transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease;
   ```
5. Do not edit tokens.css. Do not touch the `pulse`/`shimmer` keyframes or any other rule.

## Boundaries

- Do NOT change any easing keyword (keep `ease`) — only the duration values change.
- Do NOT add or remove any transition property; do not touch selectors, colors, or layout.
- Do NOT touch tokens.css, App.tsx, or the frozen legacy variables block in tokens.css.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: from repo root run `pnpm --filter @agentmesa/client typecheck` — must pass (CSS isn't typechecked, but this confirms nothing else broke). Then run `grep -n "120ms\|140ms" packages/client/src/styles.css` — expected: **no output** (no hardcoded fast durations remain).
- **Feel check**: run the UI (`pnpm --filter @agentmesa/client dev`), hover run-cards, session-cards, event filters, room rows, agent picks. The hover response should feel identical to before (120ms vs 140ms is near-imperceptible); nothing slower, nothing instant.
- **Done when**: the five selectors above all use `var(--motion-fast)`, grep finds no `120ms`/`140ms` literals in styles.css, and hover behavior is visually unchanged.
