import type { MesaAgent } from '@agentmesa/protocol';
import { AvatarStack } from '../ui/avatar.js';
import { StatusChip } from '../ui/badge.js';
import { IconButton } from '../ui/icon-button.js';
import { SemanticDot } from '../ui/semantic-dot.js';
import { Info } from '../ui/icons.js';

export function ChatHeader({
  kind,
  title,
  status,
  participants,
  bridge,
  meta,
  roomLive,
  onOpenDrawer,
}: {
  kind: 'meeting' | 'room';
  title: string;
  status?: string;
  participants?: MesaAgent[];
  bridge?: string;
  meta?: string;
  roomLive?: boolean;
  onOpenDrawer: () => void;
}) {
  return (
    <header className="chat-head">
      <div className="chat-head__title">
        <h2>{title}</h2>
        {kind === 'meeting' && status ? <StatusChip status={status} /> : null}
        {kind === 'room' ? (
          <span className="room-live" title={roomLive ? '实时推送已连接' : '实时推送未连接（低频轮询兜底）'}>
            <SemanticDot tone={roomLive ? 'success' : 'muted'} />
            {roomLive ? '实时' : '轮询'}
          </span>
        ) : null}
      </div>
      <div className="chat-head__meta">
        {kind === 'meeting' && participants && participants.length > 0 ? (
          <>
            <AvatarStack agents={participants} size="sm" />
            <small>{participants.length} 位 Agent</small>
            {bridge ? <small className="chat-head__bridge">{bridge}</small> : null}
          </>
        ) : null}
        {kind === 'room' && meta ? <small>{meta}</small> : null}
        <IconButton label="详情" aria-label="详情" onClick={onOpenDrawer}>
          <Info size={17} />
        </IconButton>
      </div>
    </header>
  );
}
