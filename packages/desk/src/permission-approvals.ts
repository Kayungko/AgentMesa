import type { DriverPermissionRequest } from '@agentmesa/runner';

/**
 * Desk-side human approval bridge for driver permission requests.
 *
 * Deep-driver runs (packages/runner `createPolicyPermissionResponder`) consult
 * an optional `askHuman` gate for "policy allows but requires confirmation"
 * operations. This module turns that callback into a desk-process-wide pending
 * queue that the desktop UI can list and decide over HTTP
 * (`GET /api/permissions/pending`, `POST /api/permissions/:id/decide`).
 *
 * Fail-closed by design: an approval that is never answered resolves `deny`
 * when `timeoutMs` elapses, and `clear()` (desk stop / workspace switch)
 * denies everything still pending.
 */

/** UI-facing shape of one pending driver permission approval. */
export interface PendingPermissionApproval {
  /** Driver-scoped request id (`DriverPermissionRequest.requestId`). */
  id: string;
  kind: 'tool' | 'command' | 'patch';
  title: string;
  /** Command line / tool name / path summary, extracted defensively from `title`/`detail`. */
  resource?: string;
  /** Why confirmation is required, when the caller can tell. */
  reason?: string;
  /** ISO timestamp of when the request was enqueued. */
  requestedAt: string;
  /** Meeting the request belongs to, when the caller can tell (closure-injected). */
  meetingId?: string;
}

export interface PermissionApprovalEnqueueOptions {
  meetingId?: string;
  /** Auto-deny after this many ms. Defaults to {@link DEFAULT_PERMISSION_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Default human-answer window: 5 minutes, matching the session run ballpark. */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 300_000;

interface QueueEntry {
  pending: PendingPermissionApproval;
  resolve: (decision: 'allow' | 'deny') => void;
  timer: NodeJS.Timeout;
}

const KINDS: ReadonlySet<string> = new Set(['tool', 'command', 'patch']);

/** `detail` is `unknown` on the wire — pull a short resource string without trusting it. */
function extractResource(request: DriverPermissionRequest): string | undefined {
  const { detail } = request;
  if (detail !== null && typeof detail === 'object') {
    for (const key of ['command', 'tool', 'tool_name', 'path', 'file_path', 'file']) {
      const value = (detail as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    // Patch-style payloads: `changes[].path` / `files[]`.
    for (const key of ['changes', 'files']) {
      const value = (detail as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        const paths = value
          .filter((item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object')
          .map((item) => item['path'])
          .filter((item): item is string => typeof item === 'string');
        if (paths.length > 0) {
          return paths.slice(0, 5).join(', ');
        }
      }
    }
  }
  if (typeof detail === 'string' && detail.length > 0) {
    return detail.length <= 120 ? detail : `${detail.slice(0, 117)}...`;
  }
  return undefined;
}

/** Same defensive extraction for an optional human-readable reason. */
function extractReason(request: DriverPermissionRequest): string | undefined {
  const { detail } = request;
  if (detail !== null && typeof detail === 'object') {
    for (const key of ['reason', 'description']) {
      const value = (detail as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * In-process pending approval queue. One instance lives in the DeskServer;
 * `enqueue` is what `createDeskAskHuman` hands to the runner as `askHuman`.
 */
export class PermissionApprovalQueue {
  private readonly entries = new Map<string, QueueEntry>();

  /**
   * Register a pending approval and return the promise the driver awaits.
   * After `timeoutMs` (default 5 min) the promise resolves `'deny'` and the
   * entry leaves the queue. A duplicate `requestId` denies the older entry
   * first (fail-closed) before queueing the new one.
   */
  enqueue(
    request: DriverPermissionRequest,
    options: PermissionApprovalEnqueueOptions = {},
  ): Promise<'allow' | 'deny'> {
    if (this.entries.has(request.requestId)) {
      this.decide(request.requestId, 'deny');
    }

    const pending: PendingPermissionApproval = {
      id: request.requestId,
      kind: KINDS.has(request.kind) ? request.kind : 'tool',
      title: request.title,
      resource: extractResource(request),
      reason: extractReason(request),
      requestedAt: new Date().toISOString(),
      ...(options.meetingId ? { meetingId: options.meetingId } : {}),
    };

    return new Promise<'allow' | 'deny'>((resolve) => {
      const timer = setTimeout(() => {
        this.entries.delete(pending.id);
        resolve('deny');
      }, options.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS);
      timer.unref?.();
      this.entries.set(pending.id, { pending, resolve, timer });
    });
  }

  /** Snapshot of everything awaiting a human decision (oldest first). */
  list(): PendingPermissionApproval[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.pending }));
  }

  /**
   * Resolve one approval. Returns `true` when the id was pending (and the
   * driver's promise is now settled); `false` for unknown/already-settled ids.
   */
  decide(id: string, decision: 'allow' | 'deny'): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    this.entries.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(decision === 'allow' ? 'allow' : 'deny');
    return true;
  }

  /** Deny everything still pending (desk stop / workspace switch). */
  clear(): void {
    for (const id of [...this.entries.keys()]) {
      this.decide(id, 'deny');
    }
  }
}

/**
 * Convenience factory: an `askHuman` implementation backed by the queue. The
 * runner's `DriverPermissionRequest` carries no meeting context, so `meetingId`
 * (and the auto-deny `timeoutMs`) come from the closure — the call site knows
 * which meeting it is activating an agent for.
 *
 * ```ts
 * const askHuman = createDeskAskHuman(queue, { meetingId });
 * attachPermissionResponder(options, { ctx, actor, askHuman });
 * ```
 */
export function createDeskAskHuman(
  queue: PermissionApprovalQueue,
  options: Pick<PermissionApprovalEnqueueOptions, 'meetingId' | 'timeoutMs'> = {},
): (request: DriverPermissionRequest) => Promise<'allow' | 'deny'> {
  return (request: DriverPermissionRequest) => queue.enqueue(request, options);
}
