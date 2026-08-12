import type { ChildProcess } from 'node:child_process';

/**
 * Process-level registry of in-flight session-collaboration CLI children.
 *
 * The desk long-lived host registers every CLI it spawns (claude -p / codex
 * exec) here so that a shutdown or workspace switch can kill them instead of
 * leaving orphaned processes burning tokens in the background. Kept in its own
 * tiny module (no imports) so `SessionRunner` can pull it in without creating
 * a cycle back through `run-executor` → `runner-factory` → `SessionRunner`.
 */
const active = new Set<ChildProcess>();

/** Register a spawned session CLI child; auto-deregisters on exit. */
export function trackSessionChild(child: ChildProcess): void {
  active.add(child);
  child.once('close', () => {
    active.delete(child);
  });
}

/** SIGTERM every in-flight session CLI. Call on host shutdown. */
export function terminateSessionChildren(): void {
  for (const child of [...active]) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already exited between iteration and kill — nothing to do.
    }
  }
}

/** Number of currently-tracked in-flight session CLI processes. */
export function activeSessionChildCount(): number {
  return active.size;
}
