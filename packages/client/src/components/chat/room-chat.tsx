import { useEffect, useMemo, useRef, useState } from 'react';
import { inviteRoomMember, sendRoomMessage } from '../../api.js';
import type { RoomDetail, RuntimeConfig } from '../../types.js';
import { Avatar } from '../ui/avatar.js';
import { useFreshMembers } from '../ui/use-fresh-members.js';
import { ChatHeader } from './chat-header.js';
import { Composer } from './composer.js';
import { RoomBubbles } from './bubbles.js';
import { ChatEmpty, ChatLoading } from './empty.js';
import { collectMentionRefs, mentionableMembers } from './mention.js';
import { memberKey } from './room-grouping.js';

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
  // 按成员过滤（可多选；全不选 = 不过滤）。组件内部状态，切换群聊时重置。
  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<string>>(() => new Set());
  // @ 提及选中的成员 ref（M2 协作语义）。发送时随消息提交 mentions。
  const [selectedMentions, setSelectedMentions] = useState<ReadonlySet<string>>(() => new Set());
  const streamRef = useRef<HTMLOListElement>(null);

  const messages = detail?.messages ?? [];
  const freshIds = useFreshMembers(roomId, messages.map((message) => message.id));
  // 可 @ 的成员（排除操作者自己），供提及选择器与发送时提取使用。
  const mentionCandidates = useMemo(() => mentionableMembers(detail?.members ?? []), [detail]);

  useEffect(() => {
    setSelectedMembers(new Set());
    setSelectedMentions(new Set());
  }, [roomId]);

  const visibleMessages = useMemo(() => {
    if (selectedMembers.size === 0) return messages;
    return messages.filter((message) => selectedMembers.has(memberKey(message.from)));
  }, [messages, selectedMembers]);

  const toggleMember = (key: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
      // mentions 从草稿文本提取（选择器插入与手打的 @名字 都能命中）；
      // selectedMentions 只是选择器状态，最终以文本为准。
      const mentions = collectMentionRefs(summary, mentionCandidates);
      await sendRoomMessage(config, detail.id, {
        workspaceId: activeWorkspaceId,
        from: humanMember,
        summary,
        // 人类发送者是一等公民（M2）：显式声明 origin。
        origin: 'human',
        ...(mentions.length > 0 ? { mentions } : {}),
      });
      setDraft('');
      setSelectedMentions(new Set());
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

      {detail.members.length > 1 ? (
        <div className="chat-filter" role="group" aria-label="按成员过滤消息">
          <button
            type="button"
            className={`chip ${selectedMembers.size === 0 ? 'chip--active' : ''}`}
            aria-pressed={selectedMembers.size === 0}
            onClick={() => setSelectedMembers(new Set())}
          >
            全部
          </button>
          {detail.members.map((member) => {
            const key = memberKey(member);
            const label = member.label ?? member.ref;
            const active = selectedMembers.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`chip ${active ? 'chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleMember(key)}
              >
                <Avatar
                  name={label}
                  agentId={`${member.workspaceId}:${member.ref}`}
                  kind={member.kind === 'human' ? 'human' : 'agent'}
                  size="sm"
                />
                <span>{label}</span>
                {member.roles?.[0] ? <em className="chip__role">{member.roles[0]}</em> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <ol className="chat-stream" ref={streamRef}>
        {typeof detail.totalMessages === 'number' && detail.totalMessages > detail.messages.length ? (
          <li className="chat-system">
            <span>只显示最近 {detail.messages.length} 条（共 {detail.totalMessages} 条）</span>
          </li>
        ) : null}
        {messages.length === 0 ? (
          <ChatEmpty title="还没有消息" detail="把不同项目的会话/Agent 拉进群，开始跨项目协作。" />
        ) : visibleMessages.length === 0 ? (
          <li className="chat-system">
            <span>没有所选成员的消息</span>
          </li>
        ) : (
          <RoomBubbles messages={visibleMessages} members={detail.members} freshIds={freshIds} />
        )}
      </ol>

      <Composer
        key={roomId}
        placeholder="发消息到群聊…"
        value={draft}
        onChange={(value) => { setDraft(value); setSendError(undefined); }}
        onSend={send}
        onStub={onStub}
        mentionMembers={mentionCandidates}
        onMentionPick={(member) =>
          setSelectedMentions((prev) => new Set(prev).add(member.ref))
        }
      />
    </section>
  );
}
