import { useMemo, useState } from 'react';
import type { RoomSummary } from '../../api.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { EmptyState } from '../ui/empty.js';
import { IconButton } from '../ui/icon-button.js';
import { DownloadSimple, PencilSimple, UsersThree } from '../ui/icons.js';
import { SearchInput } from '../ui/search.js';
import { SkeletonStack } from '../ui/skeleton.js';
import { ConvRow, type ConvRowData } from './conv-row.js';

export function ConversationList({
  runtime,
  rooms,
  unread,
  activeKey,
  onOpen,
  onCreateSession,
  onCreateRoom,
  onImportSession,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  rooms: RoomSummary[];
  unread: Record<string, number>;
  activeKey?: string;
  onOpen: (key: string) => void;
  onCreateSession: () => void;
  onCreateRoom: () => void;
  onImportSession: () => void;
}) {
  const [query, setQuery] = useState('');

  const agentsById = useMemo(
    () => new Map(runtime.agents.map((agent) => [agent.id, agent])),
    [runtime.agents],
  );

  const rows = useMemo<ConvRowData[]>(() => {
    const meetings: ConvRowData[] = runtime.meetings.map((meeting) => ({
      kind: 'meeting',
      id: meeting.id,
      meeting,
      sortAt: meeting.updatedAt,
      unread: unread[`meeting:${meeting.id}`] ?? 0,
    }));
    const roomRows: ConvRowData[] = rooms.map((room) => ({
      kind: 'room',
      id: room.id,
      room,
      sortAt: room.lastMessageAt ?? room.createdAt,
      unread: unread[`room:${room.id}`] ?? 0,
    }));
    const all = [...meetings, ...roomRows].sort((a, b) => b.sortAt.localeCompare(a.sortAt));
    const keyword = query.trim().toLowerCase();
    if (!keyword) return all;
    return all.filter((row) => {
      const title = row.kind === 'meeting' ? row.meeting.title : row.room.name;
      const preview = row.kind === 'meeting'
        ? row.meeting.purpose ?? ''
        : row.room.lastMessagePreview ?? '';
      return `${title} ${preview}`.toLowerCase().includes(keyword);
    });
  }, [runtime.meetings, rooms, unread, query]);

  return (
    <aside className="conv-list no-drag">
      <header className="conv-list__head">
        <div className="panel-title-row">
          <h1>会话</h1>
          <div className="conv-list__create">
            <IconButton label="新建会话" onClick={onCreateSession}><PencilSimple size={16} /></IconButton>
            <IconButton label="新建群聊" onClick={onCreateRoom}><UsersThree size={16} /></IconButton>
            <IconButton label="导入外部会话" onClick={onImportSession}><DownloadSimple size={16} /></IconButton>
          </div>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索会话" />
      </header>

      <div className="conv-list__rows" role="listbox" aria-label="会话记录">
        {!runtime.loaded ? (
          <SkeletonStack count={3} compact />
        ) : rows.length === 0 ? (
          query.trim()
            ? <p className="list-empty">没有匹配的会话</p>
            : <EmptyState title="还没有会话" detail="新建会话或群聊，把 Agent 拉进来开始协作。" />
        ) : (
          rows.map((row) => (
            <ConvRow
              key={`${row.kind}:${row.id}`}
              row={row}
              active={`${row.kind}:${row.id}` === activeKey}
              agentsById={agentsById}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </aside>
  );
}
