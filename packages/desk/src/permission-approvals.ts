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
   * Session-scoped grants from `allow_session` decisions: meetingId → kinds
   * the human pre-approved for the rest of this desk process. Never persisted
   * — a desk restart revokes everything (that is the point of "session").
   */
  private readonly sessionGrants = new Map<string, Set<PendingPermissionApproval['kind']>>();
  private readonly onGrantHit?: (info: {
    meetingId: string;
    kind: PendingPermissionApproval['kind'];
    requestId: string;
    title: string;
  }) => void;

  constructor(options: {
    onGrantHit?: (info: {
      meetingId: string;
      kind: PendingPermissionApproval['kind'];
      requestId: string;
      title: string;
    }) => void;
  } = {}) {
    this.onGrantHit = options.onGrantHit;
  }

  /**
   * Register a pending approval and return the promise the driver awaits.
   * After `timeoutMs` (default 5 min) the promise resolves `'deny'` and the
   * entry leaves the queue. A duplicate `requestId` denies the older entry
   * first (fail-closed) before queueing the new one.
   *
   * A prior `allow_session` decision for this (meetingId, kind) short-circuits
   * the whole round-trip: no entry, no timer, no approval card — the request
   * resolves `'allow'` immediately.
   */
  enqueue(
    request: DriverPermissionRequest,
    options: PermissionApprovalEnqueueOptions = {},
  ): Promise<'allow' | 'deny'> {
    const kind: PendingPermissionApproval['kind'] = KINDS.has(request.kind) ? request.kind : 'tool';
    if (options.meetingId && this.hasSessionGrant(options.meetingId, kind)) {
      this.onGrantHit?.({
        meetingId: options.meetingId,
        kind,
        requestId: request.requestId,
        title: request.title,
      });
      return Promise.resolve('allow');
    }

    if (this.entries.has(request.requestId)) {
      this.decide(request.requestId, 'deny');
    }

    const pending: PendingPermissionApproval = {
      id: request.requestId,
      kind,
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
   *
   * `'allow_session'` resolves the driver's promise as `'allow'` and records a
   * (meetingId, kind) grant so subsequent requests of the same kind in that
   * meeting skip the queue. Entries without a meetingId degrade to a plain
   * allow (nowhere to scope the grant to).
   */
  decide(id: string, decision: 'allow' | 'deny' | 'allow_session'): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    this.entries.delete(id);
    clearTimeout(entry.timer);
    if (decision === 'allow_session') {
      const meetingId = entry.pending.meetingId;
      if (meetingId) {
        let kinds = this.sessionGrants.get(meetingId);
        if (!kinds) {
          kinds = new Set();
          this.sessionGrants.set(meetingId, kinds);
        }
        kinds.add(entry.pending.kind);
      }
      entry.resolve('allow');
      return true;
    }
    entry.resolve(decision === 'allow' ? 'allow' : 'deny');
    return true;
  }

  /** Deny everything still pending and revoke all session grants. */
  clear(): void {
    for (const id of [...this.entries.keys()]) {
      this.decide(id, 'deny');
    }
    this.sessionGrants.clear();
  }

  private hasSessionGrant(
    meetingId: string,
    kind: PendingPermissionApproval['kind'],
  ): boolean {
    return this.sessionGrants.get(meetingId)?.has(kind) === true;
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
