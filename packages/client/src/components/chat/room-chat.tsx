import { useEffect, useRef, useState } from 'react';
import { inviteRoomMember, sendRoomMessage } from '../../api.js';
import type { RoomDetail, RuntimeConfig } from '../../types.js';
import { useFreshMembers } from '../ui/use-fresh-members.js';
import { ChatHeader } from './chat-header.js';
import { Composer } from './composer.js';
import { RoomBubbles } from './bubbles.js';
import { ChatEmpty, ChatLoading } from './empty.js';

export function RoomChat({
  config,
  roomId,
  detail,
  reload,
  activeWorkspaceId,
  streamConnected,
  onOpenDrawer,
  onStub,
}: {
  config: RuntimeConfig;
  roomId: string;
  detail: RoomDetail | undefined;
  reload: () => void;
  activeWorkspaceId: string;
  streamConnected: boolean;
  onOpenDrawer: () => void;
  onStub?: (label: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string>();
  const streamRef = useRef<HTMLOListElement>(null);

  const messages = detail?.messages ?? [];
  const freshIds = useFreshMembers(roomId, messages.map((message) => message.id));

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [roomId, messages.length]);

  // The human operator speaks as themselves, never as a picked session/agent.
  // Sending with a spoofed identity was the P0 defect; the sender is always the
  // current user, auto-joined into the room if not already a member.
  const send = async () => {
    const summary = draft.trim();
    if (!summary || !detail) return;
    try {
      const humanMember = { workspaceId: activeWorkspaceId, kind: 'human' as const, ref: 'user', label: '我' };
      // Ensure the human is a member (auto-join) so the server accepts the post.
      if (!detail.members.some((member) => member.kind === 'human' && member.ref === 'user')) {
        await inviteRoomMember(config, detail.id, humanMember);
      }
      await sendRoomMessage(config, detail.id, {
        workspaceId: activeWorkspaceId,
        from: humanMember,
        summary,
      });
      setDraft('');
      reload();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (!detail) return <ChatLoading />;

  return (
    <section className="chat-main">
      <ChatHeader
        kind="room"
        title={detail.name}
        meta={`${detail.members.length} 成员 · 跨工作区群聊`}
        roomLive={streamConnected}
        onOpenDrawer={onOpenDrawer}
      />

      {detail.purpose ? <p className="chat-purpose">{detail.purpose}</p> : null}
      {sendError ? <p className="inline-error chat-send-error">{sendError}</p> : null}

      <ol className="chat-stream" ref={streamRef}>
        {typeof detail.totalMessages === 'number' && detail.totalMessages > detail.messages.length ? (
          <li className="chat-system">
            <span>只显示最近 {detail.messages.length} 条（共 {detail.totalMessages} 条）</span>
          </li>
        ) : null}
        {messages.length === 0 ? (
          <ChatEmpty title="还没有消息" detail="把不同项目的会话/Agent 拉进群，开始跨项目协作。" />
        ) : (
          <RoomBubbles messages={messages} freshIds={freshIds} />
        )}
      </ol>

      <Composer
        key={roomId}
        placeholder="发消息到群聊…"
        value={draft}
        onChange={(value) => { setDraft(value); setSendError(undefined); }}
        onSend={send}
        onStub={onStub}
      />
    </section>
  );
}
