import { useLayoutEffect, useRef, useState } from 'react';

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
export function useFreshMembers(scope: string | undefined, ids: string[]): Set<string> {
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
