import type { RoomMember } from '@agentmesa/protocol';

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

export type AvatarAccent = 'orange' | 'blue' | 'green' | 'violet' | 'slate';

const ACCENTS: AvatarAccent[] = ['orange', 'blue', 'green', 'violet', 'slate'];

export function hashOf(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

export function accentFor(id: string): AvatarAccent {
  return ACCENTS[hashOf(id) % ACCENTS.length]!;
}

export const memberKindLabels: Record<RoomMember['kind'], string> = {
  session: '会话',
  agent: 'Agent',
  human: '我',
};
