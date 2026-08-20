import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { MesaAgent, MesaMessage, RoomMessage } from '@agentmesa/protocol';
import { Avatar } from '../ui/avatar.js';
import { memberKindLabels } from '../ui/format.js';
import { DayDivider, dayLabel } from './divider.js';

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
  freshIds,
}: {
  messages: RoomMessage[];
  freshIds: Set<string>;
}) {
  const items: ReactNode[] = [];
  let lastDay = '';
  for (const message of messages) {
    const day = dayLabel(message.createdAt);
    if (day !== lastDay) {
      items.push(<DayDivider key={`day-${message.id}`} label={day} />);
      lastDay = day;
    }
    // The human operator speaks as themselves (auto-joined as kind 'human').
    const mine = message.from.kind === 'human' && message.from.ref === 'user';
    const label = message.from.label ?? message.from.ref;
    const typeLabel = message.type !== 'general' ? typeLabels[message.type] ?? message.type : undefined;
    items.push(
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
              <em className="chat-msg__kind">{memberKindLabels[message.from.kind]}</em>
              {typeLabel ? <em className="chat-msg__type">{typeLabel}</em> : null}
              <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
            </span>
          ) : null}
          <div className="bubble" title={mine ? new Date(message.createdAt).toLocaleTimeString() : undefined}>
            <p>{message.summary}</p>
          </div>
        </div>
      </li>,
    );
  }
  return <>{items}</>;
}
