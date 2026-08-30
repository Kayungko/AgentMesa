import { useEffect, useState } from 'react';
import type { MesaAgent } from '@agentmesa/protocol';
import { accentFor, hashOf, initials } from './format.js';

// Notion 风手绘线稿头像(由 notion-avatar 部件预组合生成,见 public/avatars/SOURCE.md)。
const AVATAR_ASSETS = [
  'claude-scientist',
  'codex-technologist',
  'chapter-detective',
  'api-robot',
  'dashboard-astronaut',
  'knowledge-mage',
  'market-artist',
  'notion-avatar-01',
  'notion-avatar-02',
  'notion-avatar-03',
  'notion-avatar-04',
  'notion-avatar-05',
  'notion-avatar-06',
  'notion-avatar-07',
  'notion-avatar-08',
  'notion-avatar-09',
  'notion-avatar-10',
  'notion-avatar-11',
  'notion-avatar-12',
] as const;

/** Pinned mapping first (claude/codex), role-keyword fallback, else undefined. */
export function avatarAssetFor(agentId: string, name: string, roles: string[] = []): string | undefined {
  const key = `${agentId} ${name}`.toLowerCase();
  if (key.includes('claude')) return 'claude-scientist';
  if (key.includes('codex')) return 'codex-technologist';
  const joined = roles.join(' ').toLowerCase();
  if (/(review|test|audit)/.test(joined)) return 'chapter-detective';
  if (/(research|analyst|knowledge)/.test(joined)) return 'knowledge-mage';
  if (/(build|maintain|develop)/.test(joined)) return 'codex-technologist';
  return undefined;
}

export function Avatar({
  name,
  agentId,
  roles,
  kind = 'agent',
  size = 'md',
}: {
  name: string;
  agentId?: string;
  roles?: string[];
  kind?: 'agent' | 'human';
  size?: 'sm' | 'md' | 'lg';
}) {
  const id = agentId ?? name;
  const accent = accentFor(id);
  const asset = kind === 'agent'
    ? avatarAssetFor(id, name, roles ?? []) ?? AVATAR_ASSETS[hashOf(id) % AVATAR_ASSETS.length]
    : undefined;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [asset]);
  const src = asset ? `${import.meta.env.BASE_URL}avatars/${asset}.svg` : undefined;
  return (
    <span className={`avatar avatar--${accent} avatar--${size}`} title={name} aria-label={`${name} 头像`}>
      {src && !broken
        ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
        : initials(name)}
    </span>
  );
}

export function AvatarStack({ agents, size = 'md' }: { agents: MesaAgent[]; size?: 'sm' | 'md' }) {
  if (agents.length === 0) {
    return <span className="avatar-stack avatar-stack--empty"><span className="avatar-stack__none">尚无 Agent</span></span>;
  }
  const shown = agents.slice(0, 4);
  const extra = agents.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((agent) => (
        <Avatar key={agent.id} name={agent.name} agentId={agent.id} roles={agent.roles} size={size} />
      ))}
      {extra > 0 ? <span className={`avatar avatar--slate avatar--${size} avatar-stack__extra`}>+{extra}</span> : null}
    </span>
  );
}
