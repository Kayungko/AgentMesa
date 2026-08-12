// ---------------------------------------------------------------------------
// ui — atomic components and pure helpers shared across the app.
// Extracted verbatim from App.tsx (S1 atomic move); no logic changes.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useRef, useState } from 'react';
import type { MesaAgent, RoomMember } from '@agentmesa/protocol';
import type { ConnectionState } from './useMesaRuntime.js';

export const connectionLabels: Record<ConnectionState, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重新连接中',
  offline: '离线',
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection connection--${state}`}>
      <span className="connection__dot" />
      {connectionLabels[state]}
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

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty-state">
      <svg className="empty-state__mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M18 45 V28 H26 L32 37 L38 28 H46 V45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? (
        <button type="button" className="button button--primary empty-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonStack({ count, compact = false }: { count: number; compact?: boolean }) {
  return (
    <div className="stack">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton ${compact ? 'skeleton--compact' : ''}`} />
      ))}
    </div>
  );
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function agentTone(agentId: string): string {
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tones = ['tone-violet', 'tone-mint', 'tone-amber', 'tone-coral'] as const;
  return tones[hash % tones.length]!;
}

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

export const memberKindLabels: Record<RoomMember['kind'], string> = {
  session: '会话',
  agent: 'Agent',
  human: '我',
};

export function AgentMark({ agent, size = 'md' }: { agent: MesaAgent; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`agent-mark agent-mark--${size} ${agentTone(agent.id)}`} title={`${agent.name} (${agent.id})`}>
      {initials(agent.name)}
    </span>
  );
}

export function AgentStack({ agents, size = 'md' }: { agents: MesaAgent[]; size?: 'sm' | 'md' }) {
  if (agents.length === 0) {
    return <span className="agent-stack agent-stack--empty"><span className="agent-stack__none">尚无 Agent</span></span>;
  }
  const shown = agents.slice(0, 4);
  const extra = agents.length - shown.length;
  return (
    <span className="agent-stack">
      {shown.map((agent) => <AgentMark key={agent.id} agent={agent} size={size} />)}
      {extra > 0 ? <span className={`agent-mark agent-mark--extra agent-mark--${size}`}>+{extra}</span> : null}
    </span>
  );
}
