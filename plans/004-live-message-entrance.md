# 004 — Entrance animation for live-arriving messages

- **Status**: DONE
- **Commit**: aba01d5
- **Severity**: MEDIUM
- **Category**: Missed opportunity (chat-grammar core moment)
- **Estimated scope**: 2 files, ~45 lines added

## Problem

This product's thesis is "agents collaborating like coworkers in a group chat" (see DIRECTION CONTRACT in `packages/client/src/styles/tokens.css:1-27`). Yet when a live message arrives — pushed over SSE and re-fetched into the timeline — it simply pops into existence with no motion:

```tsx
/* packages/client/src/App.tsx:1119-1121 — current (TimelineItem render) */
  return (
    <li className={`timeline-item ${agent ? '' : 'timeline-item--system'}`}>
      <span className="timeline-item__marker" aria-hidden="true" />

/* packages/client/src/App.tsx:1524-1526 — current (RoomMessageItem render) */
  return (
    <li className={`room-msg ${message.from.kind === 'agent' ? 'room-msg--agent' : ''}`}>
      <span className="room-msg__marker" aria-hidden="true" />
```

The lists are keyed by message id and re-fetched wholesale on each SSE event (`reload()` in `SessionDetailView`, App.tsx:1178-1198; room stream in `RoomsView`, App.tsx:1595-1611), so newly arrived messages are distinguishable by id — they just aren't.

## Target

Newly arrived messages fade in with a 4px rise, 200ms, strong ease-out. Initial history loads and room/session switches do NOT animate — only items that arrive while the user is already looking at that conversation.

```css
/* target CSS */
@keyframes msg-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.timeline-item.msg-enter,
.room-msg.msg-enter {
  animation: msg-in var(--motion-base) var(--ease-out) both;
}
@media (prefers-reduced-motion: reduce) {
  .timeline-item.msg-enter,
  .room-msg.msg-enter,
  .approval-card.msg-enter {   /* selector used by plan 005; harmless if 005 never runs */
    animation: none;
  }
}
```

- `--motion-base` = 200ms, `--ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)` — both defined in `packages/client/src/styles/tokens.css:145-147`.
- Keyframes are correct here (not transitions): each message is a fresh DOM node inserted once; nothing re-triggers on the same node, so the "keyframes restart from zero" interruptibility problem does not apply.

### The freshness hook (copy exactly)

The app renders under React StrictMode (`packages/client/src/main.tsx:11`), which double-invokes effects in dev. The hook seeds its "already seen" baseline inside `useLayoutEffect`, idempotently (seed only if the scope was never seen), so the double invocation seeds the same set twice and never swallows the animation. `useLayoutEffect` (not `useEffect`) so the class lands before the browser paints — otherwise the message flashes at full opacity for one frame before fading in.

```tsx
/* target: insert into packages/client/src/App.tsx after the statusClass function (~line 763) */

/**
 * Entrance-animation support: returns the IDs in `ids` that were not present
 * the first time `scope` was observed. The first non-empty observation per
 * scope becomes the baseline (nothing animates); IDs arriving in later
 * renders are returned so callers can attach an entrance class to them.
 *
 * Seeding runs in useLayoutEffect so the entrance class lands before the
 * browser paints (no one-frame flash at full opacity), and seeding is
 * idempotent so React StrictMode's double-invoked effects don't swallow
 * the animation.
 */
function useFreshMembers(scope: string | undefined, ids: string[]): Set<string> {
  const seededRef = useRef(new Map<string, Set<string>>());
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = ids.join('|');
  useLayoutEffect(() => {
    if (scope === undefined || ids.length === 0) {
      setFresh(new Set());
      return;
    }
    const seeded = seededRef.current.get(scope);
    if (!seeded) {
      seededRef.current.set(scope, new Set(ids));
      setFresh(new Set());
      return;
    }
    const next = new Set<string>();
    for (const id of ids) {
      if (!seeded.has(id)) {
        next.add(id);
        seeded.add(id);
      }
    }
    setFresh(next);
  }, [scope, key]);
  return fresh;
}
```

## Repo conventions to follow

- All components and helpers live flat in `packages/client/src/App.tsx` (a single 2400-line view layer) — add the hook there, not in a new file.
- Component styles live flat in `packages/client/src/styles.css`; append the CSS block in a new commented section at the end of the file.
- Motion tokens come from `styles/tokens.css` (already imported first in App.tsx:38-39).

## Steps

1. `packages/client/src/App.tsx` line 1 — add `useLayoutEffect` to the React import:
   ```tsx
   import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
   ```
2. Insert the `useFreshMembers` function (verbatim, above) after the `statusClass` function (App.tsx:758-763).
3. `SessionDetailView`: after `const timelineRef = useRef<HTMLOListElement>(null);` (App.tsx:1155) and BEFORE the `if (loading)` early return (App.tsx:1287) — hooks must not sit after an early return — add:
   ```tsx
   const freshMessageIds = useFreshMembers(
     meetingId,
     (detail?.messages ?? []).map((message) => message.id),
   );
   ```
4. Update `TimelineItem`'s signature and class (App.tsx:1109-1121):
   ```tsx
   function TimelineItem({ message, agentsById, fresh = false }: { message: MesaMessage; agentsById: Map<string, MesaAgent>; fresh?: boolean }) {
   ```
   and
   ```tsx
   <li className={`timeline-item ${agent ? '' : 'timeline-item--system'} ${fresh ? 'msg-enter' : ''}`}>
   ```
5. Pass the flag in the timeline map (App.tsx:1446-1452):
   ```tsx
   <TimelineItem key={message.id} message={message} agentsById={agentsById} fresh={freshMessageIds.has(message.id)} />
   ```
6. `RoomsView`: after `const msgListRef = useRef<HTMLOListElement>(null);` (App.tsx:1563) add:
   ```tsx
   const freshMessageIds = useFreshMembers(
     selected?.id,
     (selected?.messages ?? []).map((message) => message.id),
   );
   ```
7. Update `RoomMessageItem` (App.tsx:1522-1526):
   ```tsx
   function RoomMessageItem({ message, fresh = false }: { message: RoomMessage; fresh?: boolean }) {
   ```
   ```tsx
   <li className={`room-msg ${message.from.kind === 'agent' ? 'room-msg--agent' : ''} ${fresh ? 'msg-enter' : ''}`}>
   ```
8. Pass the flag in the room list map (App.tsx:1847):
   ```tsx
   selected.messages.map((message) => <RoomMessageItem key={message.id} message={message} fresh={freshMessageIds.has(message.id)} />)
   ```
9. `packages/client/src/styles.css` — append at the end of the file:
   ```css
   /* --- Entrance for live-arriving items (plans 004/005) --- */
   @keyframes msg-in {
     from { opacity: 0; transform: translateY(4px); }
     to { opacity: 1; transform: translateY(0); }
   }
   .timeline-item.msg-enter,
   .room-msg.msg-enter {
     animation: msg-in var(--motion-base) var(--ease-out) both;
   }
   @media (prefers-reduced-motion: reduce) {
     .timeline-item.msg-enter,
     .room-msg.msg-enter,
     .approval-card.msg-enter {
       animation: none;
     }
   }
   ```

## Boundaries

- Do NOT animate initial history loads or conversation switches — the baseline logic exists precisely to prevent that. If you see whole-list fade on open, the hook was wired wrong; fix the wiring, don't "simplify" it away.
- Do NOT add stagger between simultaneous arrivals; do NOT touch the auto-scroll behavior (`scrollIntoView` at App.tsx:1172-1175, `scrollTop` at App.tsx:1631-1634).
- Do NOT change message markup beyond the className and prop additions shown.
- Do NOT touch tokens.css. No new dependencies.
- If a step doesn't match the code you find (drift since commit d34b661), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @agentmesa/client typecheck` passes.
- **Feel check**: run the UI and the desk server; open a session or room, then trigger a new message (post one via the input or from another agent session):
  - the NEW message fades in with a small rise (~200ms); the rest of the history does not move or re-fade;
  - reload the page or switch rooms: the full history appears instantly — zero animation on load/switch;
  - two messages arriving back-to-back each animate independently, no restart or skip;
  - the list still auto-scrolls to show arrivals;
  - DevTools Animations panel at 25%: single 200ms animation per arrival, ease-out curve;
  - emulate `prefers-reduced-motion: reduce` (Rendering panel): arrivals appear instantly.
- **Done when**: live arrivals fade+rise once; loads and switches are animation-free; reduced motion is respected.
