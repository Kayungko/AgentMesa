import type { ConnectionState } from '../../useMesaRuntime.js';

export const connectionLabels: Record<ConnectionState, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重新连接中',
  offline: '离线',
};

// Class names `.connection` / `.connection__dot` and the 「已连接」 copy are a
// desktop smoke-test contract — keep them when re-skinning.
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection connection--${state}`}>
      <span className="connection__dot" />
      {connectionLabels[state]}
    </span>
  );
}

export function AgentConnectionBadge({ active, cliAvailable }: { active: boolean; cliAvailable: boolean }) {
  const label = active ? '工作中' : cliAvailable ? 'CLI 已连通' : '已注册';
  const kind = active ? 'active' : cliAvailable ? 'ready' : 'idle';
  return (
    <span className={`agent-state agent-state--${kind}`}>
      <span className="agent-state__dot" />
      {label}
    </span>
  );
}

export const runStateLabels: Record<string, string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// Task statuses a human can drive from the workspace (matching the protocol's
// canTransitionTaskStatus allowlist at the server layer).
export const TASK_STATUSES = [
  'backlog', 'todo', 'in_progress', 'in_review', 'needs_fix', 'approved',
  'completed', 'blocked', 'cancelled',
] as const;

export function statusClass(status: string): string {
  if (['active', 'open', 'running', 'pending', 'in_progress', 'in_review'].includes(status)) return 'status--running';
  if (['completed', 'approved', 'done'].includes(status)) return 'status--completed';
  if (['failed', 'blocked', 'archived', 'closed'].includes(status)) return 'status--failed';
  return 'status--idle';
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={`status-chip ${statusClass(status)}`}>{label ?? status}</span>;
}

/**
 * Meeting trust level chip. `approval` (default): gated speech actions go
 * through human approval cards. `trusted`: the human's explicit decision to
 * let writes be judged by role capabilities without per-action cards.
 */
export function TrustChip({ trustLevel }: { trustLevel: 'approval' | 'trusted' }) {
  if (trustLevel === 'trusted') {
    return <span className="status-chip status--completed">受信</span>;
  }
  return <span className="status-chip status--idle">人审</span>;
}

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <b className="unread-badge">{count > 99 ? '99+' : count}</b>;
}
