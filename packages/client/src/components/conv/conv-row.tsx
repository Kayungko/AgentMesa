import { useMemo } from 'react';
import type { MesaAgent, MesaMeeting } from '@agentmesa/protocol';
import type { RoomSummary } from '../../api.js';
import { Avatar, AvatarStack } from '../ui/avatar.js';
import { UnreadBadge } from '../ui/badge.js';
import { formatTime } from '../ui/format.js';
import { UsersThree } from '../ui/icons.js';

export type ConvRowData =
  | { kind: 'meeting'; id: string; meeting: MesaMeeting; sortAt: string; unread: number }
  | { kind: 'room'; id: string; room: RoomSummary; sortAt: string; unread: number };

export function ConvRow({
  row,
  active,
  agentsById,
  onOpen,
}: {
  row: ConvRowData;
  active: boolean;
  agentsById: Map<string, MesaAgent>;
  onOpen: (key: string) => void;
}) {
  const key = `${row.kind}:${row.id}`;

  const participants = useMemo(
    () => (row.kind === 'meeting'
      ? (row.meeting.agents ?? [])
        .map((id) => agentsById.get(id))
        .filter((agent): agent is MesaAgent => Boolean(agent))
      : []),
    [row, agentsById],
  );

  return (
    <button
      type="button"
      className={`conv-row ${active ? 'conv-row--active' : ''}`}
      onClick={() => onOpen(key)}
    >
      {row.kind === 'meeting' ? (
        <span className="conv-row__avatar"><AvatarStack agents={participants} size="sm" /></span>
      ) : (
        <span className="conv-row__avatar conv-row__avatar--room">
          <UsersThree size={18} weight="fill" />
        </span>
      )}
      <span className="conv-row__body">
        <span className="conv-row__top">
          <strong>{row.kind === 'meeting' ? row.meeting.title : row.room.name}</strong>
          <small>{formatTime(row.sortAt)}</small>
        </span>
        <span className="conv-row__bottom">
          <small>
            {row.kind === 'meeting'
              ? row.meeting.purpose ?? `${row.meeting.tasks.length} 个任务`
              : row.room.lastMessagePreview ?? `${row.room.members.length} 成员`}
          </small>
          <UnreadBadge count={row.unread} />
        </span>
      </span>
    </button>
  );
}
