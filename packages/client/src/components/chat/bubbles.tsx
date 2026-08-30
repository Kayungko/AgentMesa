import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MesaAgent, MesaMessage, RoomMember, RoomMessage } from '@agentmesa/protocol';
import { Avatar } from '../ui/avatar.js';
import { memberKindLabels } from '../ui/format.js';
import { DayDivider, dayLabel } from './divider.js';
import { splitMentionSegments } from './mention.js';
import { agentRunSummary, groupRoomMessages, memberKey, SYSTEM_MESSAGE_TYPES } from './room-grouping.js';

export const typeLabels: Record<string, string> = {
  task_created: '创建了任务',
  handoff: '交接',
  review_request: '请求评审',
  review_result: '评审结果',
  fix_request: '请求修复',
  fix_done: '修复完成',
  test_result: '测试结果',
  decision: '决策',
  status_changed: '状态变更',
  task_assignment: '任务指派',
  status_update: '状态更新',
  review_feedback: '评审反馈',
  implementation_summary: '实现总结',
  question: '提问',
  answer: '回答',
};

export function MeetingBubbles({
  messages,
  agentsById,
  freshIds,
}: {
  messages: MesaMessage[];
  agentsById: Map<string, MesaAgent>;
  freshIds: Set<string>;
}) {
  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages],
  );
  const items: ReactNode[] = [];
  let lastDay = '';
  for (const message of sorted) {
    const day = dayLabel(message.createdAt);
    if (day !== lastDay) {
      items.push(<DayDivider key={`day-${message.id}`} label={day} />);
      lastDay = day;
    }
    const senderId = message.senderAgentId ?? message.from;
    // The desk posts as a fixed human actor (`user:desk` by default,
    // `user:desktop` from the desktop app — sender can never be spoofed);
    // render any `user:*` actor as the operator's own bubble on the right.
    const mine = senderId.startsWith('user:');
    const agent = agentsById.get(senderId);
    if (!mine && !agent && senderId === 'system') {
      items.push(
        <li key={message.id} className={`chat-system ${freshIds.has(message.id) ? 'msg-enter' : ''}`}>
          <span>{message.summary}</span>
          <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
        </li>,
      );
      continue;
    }
    const label = agent ? agent.name : mine ? '我' : senderId;
    const typeLabel = message.type !== 'general' ? typeLabels[message.type] ?? message.type : undefined;
    items.push(
      <li
        key={message.id}
        className={`chat-msg ${mine ? 'chat-msg--own' : ''} ${freshIds.has(message.id) ? 'msg-enter' : ''}`}
      >
        {!mine ? (
          agent
            ? <Avatar name={agent.name} agentId={agent.id} roles={agent.roles} size="md" />
            : <span className="avatar avatar--slate avatar--md">?</span>
        ) : null}
        <div className="chat-msg__col">
          {!mine ? (
            <span className="chat-msg__meta">
              <strong>{label}</strong>
              {typeLabel ? <em className="chat-msg__type">{typeLabel}</em> : null}
              <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
            </span>
          ) : null}
          <div className="bubble" title={mine ? new Date(message.createdAt).toLocaleTimeString() : undefined}>
            <p>{message.summary}</p>
            {message.body ? <pre className="bubble__body">{message.body}</pre> : null}
            {mine && typeLabel ? <em className="chat-msg__type chat-msg__type--own">{typeLabel}</em> : null}
          </div>
        </div>
      </li>,
    );
  }
  return <>{items}</>;
}

export function RoomBubbles({
  messages,
  members,
  freshIds,
}: {
  messages: RoomMessage[];
  /** 房间成员（用于 @mention 高亮匹配与角色徽章回退）。 */
  members: RoomMember[];
  freshIds: Set<string>;
}) {
  // 折叠状态组件内部维护，不持久化（roomId 切换时组件随 ChatLoading 重挂载自然重置）。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo(() => groupRoomMessages(messages), [messages]);
  const memberByKey = useMemo(() => {
    const map = new Map<string, RoomMember>();
    for (const member of members) map.set(memberKey(member), member);
    return map;
  }, [members]);

  /** summary 按 @mention 切段渲染：命中的成员名高亮为 mention 胶囊。 */
  const renderSummary = (text: string): ReactNode =>
    splitMentionSegments(text, members).map((segment, index) =>
      segment.kind === 'mention'
        ? <span key={index} className="mention">{segment.text}</span>
        : segment.text,
    );

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 系统类消息走居中的 system 时间线样式（与 MeetingBubbles 的系统行一致）。
  const renderSystemLine = (message: RoomMessage) => (
    <li key={message.id} className={`chat-system ${freshIds.has(message.id) ? 'msg-enter' : ''}`}>
      <span>{message.type !== 'general' ? `${typeLabels[message.type] ?? message.type} · ` : ''}{message.summary}</span>
      <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
    </li>
  );

  const renderMessage = (message: RoomMessage): ReactNode => {
    if (SYSTEM_MESSAGE_TYPES.has(message.type)) return renderSystemLine(message);
    // The human operator speaks as themselves (auto-joined as kind 'human').
    const mine = message.from.kind === 'human' && message.from.ref === 'user';
    const label = message.from.label ?? message.from.ref;
    const typeLabel = message.type !== 'general' ? typeLabels[message.type] ?? message.type : undefined;
    // 角色徽章：优先消息自带 senderRole，缺省回退成员 roles[0]，都没有则不渲染。
    const role = message.senderRole ?? memberByKey.get(memberKey(message.from))?.roles?.[0];
    return (
      <li
        key={message.id}
        className={`chat-msg ${mine ? 'chat-msg--own' : ''} ${freshIds.has(message.id) ? 'msg-enter' : ''}`}
      >
        {!mine ? (
          <Avatar
            name={label}
            agentId={`${message.from.workspaceId}:${message.from.ref}`}
            kind={message.from.kind === 'agent' ? 'agent' : 'human'}
            size="md"
          />
        ) : null}
        <div className="chat-msg__col">
          {!mine ? (
            <span className="chat-msg__meta">
              <strong>{label}</strong>
              {role ? <em className="chat-msg__role">{role}</em> : null}
              <em className="chat-msg__kind">{memberKindLabels[message.from.kind]}</em>
              {typeLabel ? <em className="chat-msg__type">{typeLabel}</em> : null}
              <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
            </span>
          ) : null}
          <div className="bubble" title={mine ? new Date(message.createdAt).toLocaleTimeString() : undefined}>
            <p>{renderSummary(message.summary)}</p>
          </div>
        </div>
      </li>
    );
  };

  // 可折叠块（agent 互答 / 系统事件）：header 一行摘要 + 展开后的原始消息。
  const renderFold = (item: { messages: RoomMessage[] } & ({ kind: 'agent-run' } | { kind: 'system-events' })) => {
    const key = item.messages[0]!.id;
    const open = expanded.has(key);
    const summary = item.kind === 'agent-run'
      ? agentRunSummary(item.messages)
      : `${item.messages.length} 条系统事件`;
    return (
      <li key={`fold-${key}`} className={`fold ${item.kind === 'system-events' ? 'fold--system' : ''}`}>
        <button type="button" className="fold__toggle" aria-expanded={open} onClick={() => toggle(key)}>
          <span className="fold__summary">{summary}</span>
          <small className="fold__action">{open ? '收起' : '展开'}</small>
        </button>
        {open ? (
          <ul className="fold__body">
            {item.messages.map((message) =>
              item.kind === 'system-events' ? renderSystemLine(message) : renderMessage(message),
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  const nodes: ReactNode[] = [];
  let lastDay = '';
  for (const item of items) {
    const first = item.kind === 'single' ? item.message : item.messages[0]!;
    const day = dayLabel(first.createdAt);
    if (day !== lastDay) {
      nodes.push(<DayDivider key={`day-${first.id}`} label={day} />);
      lastDay = day;
    }
    if (item.kind === 'single') nodes.push(renderMessage(item.message));
    else nodes.push(renderFold(item));
  }
  return <>{nodes}</>;
}
