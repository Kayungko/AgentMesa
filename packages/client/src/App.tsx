import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  EventEnvelope,
  MesaAgent,
  MesaAgentRun,
  MesaArtifact,
  MesaMeeting,
  MesaMessage,
  MesaTask,
  RoomMember,
  RoomMessage,
} from '@agentmesa/protocol';
import { useMesaRuntime } from './useMesaRuntime.js';
import {
  createRoom,
  createRoomEventStream,
  inviteRoomMember,
  leaveRoomMember,
  loadArtifacts,
  loadMeeting,
  loadRoom,
  loadRooms,
  loadSetupStatus,
  loadWorkspaceAgents,
  loadWorkspaces,
  loadWorkspaceMeetings,
  postMeetingMessage,
  removeMeetingAgent,
  sendRoomMessage,
  updateMeetingStatus,
  updateTaskStatus,
  type RoomSummary,
  type SetupStatus,
} from './api.js';
import type { MeetingDetail, RoomDetail, RuntimeConfig } from './types.js';
import {
  AgentMark,
  AgentStack,
  ConnectionBadge,
  EmptyState,
  SkeletonStack,
  TASK_STATUSES,
  formatTime,
  memberKindLabels,
  statusClass,
  useFreshMembers,
} from './ui.js';
import { ApprovalCard, RunCard, RunDetailView } from './cards.js';
import { WidgetView } from './WidgetView.js';
import { DeployView } from './DeployView.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import './styles/tokens.css';
import './styles.css';

function readConfig(): RuntimeConfig {
  const params = new URLSearchParams(window.location.search);
  return {
    baseUrl: params.get('baseUrl') ?? 'http://127.0.0.1:3456',
    token: params.get('token') ?? undefined,
    view: params.get('view') === 'widget' ? 'widget' : 'main',
  };
}

// ---------------------------------------------------------------------------
// Routing — the hash is the single source of truth for the open conversation.
// ---------------------------------------------------------------------------

type Section = 'home' | 'sessions' | 'sessions-new' | 'rooms' | 'rooms-new' | 'deploy';

interface HashRoute {
  section: Section;
  sessionId?: string;
  roomId?: string;
}

function parseHashRoute(): HashRoute {
  const h = window.location.hash;
  if (h.startsWith('#/sessions/new')) return { section: 'sessions-new' };
  if (h.startsWith('#/rooms/new')) return { section: 'rooms-new' };
  if (h.startsWith('#/sessions/')) {
    return { section: 'sessions', sessionId: h.slice('#/sessions/'.length).split('/')[0] };
  }
  if (h.startsWith('#/rooms/')) {
    return { section: 'rooms', roomId: h.slice('#/rooms/'.length).split('/')[0] };
  }
  if (h.startsWith('#/sessions')) return { section: 'sessions' };
  if (h.startsWith('#/rooms')) return { section: 'rooms' };
  if (h.startsWith('#/deploy')) return { section: 'deploy' };
  return { section: 'home' };
}

// ---------------------------------------------------------------------------
// Small shared bits.
// ---------------------------------------------------------------------------

/** Day-divider label: 今天 / 昨天 / M月D日（跨年带年份）. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(undefined, options);
}

const typeLabels: Record<string, string> = {
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

function RoomGlyph() {
  return (
    <svg className="room-glyph" width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M4 5.5 h10 a1.4 1.4 0 0 1 1.4 1.4 v4.2 a1.4 1.4 0 0 1 -1.4 1.4 h-6.2 l-3 2.4 v-2.4 h-0.8 a1.4 1.4 0 0 1 -1.4 -1.4 v-4.2 a1.4 1.4 0 0 1 1.4 -1.4 z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.3" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.7" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <li className="day-divider" aria-hidden="true">
      <span>{label}</span>
    </li>
  );
}

/** The composer: an auto-growing textarea; Enter 发送、Shift+Enter 换行. */
function Composer({
  placeholder,
  value,
  onChange,
  onSend,
  sending = false,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => Promise<void> | void;
  sending?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void onSend();
          }
        }}
      />
      <button
        className="button button--primary"
        onClick={() => void onSend()}
        disabled={!value.trim() || sending}
      >
        {sending ? '发送中…' : '发送'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meeting detail hook — owns the fetch + SSE-driven live refresh for ONE open
// meeting. Live refresh rides the SHARED global event stream (useMesaRuntime),
// so no second EventSource is opened per conversation.
// ---------------------------------------------------------------------------

function useMeetingDetail(config: RuntimeConfig, meetingId: string | undefined, events: EventEnvelope[]) {
  const [detail, setDetail] = useState<MeetingDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Cursors already accounted for; only envelopes after this can trigger reload.
  const seenCursorRef = useRef<string | undefined>(undefined);

  const reload = useCallback(() => {
    if (!meetingId) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    loadMeeting(config, meetingId)
      .then((next) => { if (active) setDetail(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, meetingId]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    seenCursorRef.current = events.length > 0 ? events[events.length - 1]!.cursor : undefined;
    return reload();
    // Reset + load only when the opened meeting changes, not on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // Live refresh: scan envelopes newer than the seen cursor; any event that
  // belongs to this meeting (message, meeting change, its tasks) re-fetches.
  useEffect(() => {
    if (!meetingId || events.length === 0) return;
    if (seenCursorRef.current === undefined) {
      seenCursorRef.current = events[events.length - 1]!.cursor;
      return;
    }
    let dirty = false;
    for (let i = events.length - 1; i >= 0; i--) {
      const envelope = events[i]!;
      if (envelope.cursor === seenCursorRef.current) break;
      const evt = envelope.event;
      const taskMeetingId = (evt.data as { task?: { meetingId?: string } } | undefined)?.task?.meetingId;
      if (evt.meetingId === meetingId || taskMeetingId === meetingId) {
        dirty = true;
        break;
      }
    }
    seenCursorRef.current = events[events.length - 1]!.cursor;
    if (dirty) reload();
  }, [events, meetingId, reload]);

  return { detail, loading, error, reload, setDetail };
}

// ---------------------------------------------------------------------------
// Room detail hook — fetch + poll fallback; live bumps come from the shell's
// room stream via `version`.
// ---------------------------------------------------------------------------

function useRoomDetail(config: RuntimeConfig, roomId: string | undefined, version: number) {
  const [detail, setDetail] = useState<RoomDetail>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    if (!roomId) return;
    let active = true;
    loadRoom(config, roomId)
      .then((next) => { if (active) setDetail(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [config, roomId]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    return reload();
  }, [reload]);

  // Version bumps from the live room stream, plus a low-frequency poll as a
  // fallback for silent drops (the stream carries the real-time path).
  useEffect(() => {
    if (!roomId || version === 0) return;
    return reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    if (!roomId) return;
    const timer = setInterval(() => reload(), 30_000);
    return () => clearInterval(timer);
  }, [roomId, reload]);

  return { detail, error, reload, setDetail };
}

// ---------------------------------------------------------------------------
// Conversation chat streams.
// ---------------------------------------------------------------------------

function MeetingBubbles({
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
          agent ? <AgentMark agent={agent} size="sm" /> : <span className="agent-mark agent-mark--sm agent-mark--unknown">?</span>
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

function RoomBubbles({
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
        {!mine ? <span className={`agent-mark agent-mark--sm room-mark room-mark--${message.from.kind}`}>{label.slice(0, 1)}</span> : null}
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

// ---------------------------------------------------------------------------
// Meeting chat — center column for a session (meeting).
// ---------------------------------------------------------------------------

function MeetingChat({
  config,
  runtime,
  meetingId,
  detail,
  loading,
  loadError,
  reload,
  selectedRun,
  onSelectRun,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
  meetingId: string;
  detail: MeetingDetail | undefined;
  loading: boolean;
  loadError: string | undefined;
  reload: () => void;
  selectedRun?: MesaAgentRun;
  onSelectRun: (run: MesaAgentRun) => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const streamRef = useRef<HTMLOListElement>(null);

  const agentsById = useMemo(
    () => new Map(runtime.agents.map((agent) => [agent.id, agent])),
    [runtime.agents],
  );
  const participants = useMemo(
    () => (detail?.agents ?? [])
      .map((id) => agentsById.get(id))
      .filter((agent): agent is MesaAgent => Boolean(agent)),
    [detail?.agents, agentsById],
  );

  const messages = detail?.messages ?? [];
  const freshIds = useFreshMembers(meetingId, messages.map((message) => message.id));

  // Cards that live IN the stream: waiting approvals for this meeting's tasks,
  // and active runs of this meeting's agents — work artifacts, not dashboard.
  const meetingTaskIds = useMemo(() => new Set(detail?.tasks ?? []), [detail?.tasks]);
  const streamApprovals = useMemo(
    () => runtime.workflows.filter((workflow) => {
      if (workflow.status !== 'waiting_approval') return false;
      const task = runtime.tasks.find((entry) => entry.id === workflow.taskId);
      return task ? meetingTaskIds.has(task.id) : false;
    }),
    [runtime.workflows, runtime.tasks, meetingTaskIds],
  );
  const streamRuns = useMemo(
    () => runtime.activeRuns.filter((run) => (detail?.agents ?? []).includes(run.agentId)),
    [runtime.activeRuns, detail?.agents],
  );

  // Approvals that arrive while this meeting is open enter with the shared
  // msg-in animation; cards already present on first render are the baseline
  // and never animate (plan 005).
  const freshApprovalIds = useFreshMembers(meetingId, streamApprovals.map((workflow) => workflow.workflowId));

  // Keep the newest message visible.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [meetingId, messages.length, streamApprovals.length, streamRuns.length]);

  const send = async () => {
    const summary = draft.trim();
    if (!summary || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      await postMeetingMessage(config, { meetingId, summary });
      setDraft('');
      reload();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  if (loading && !detail) {
    return (
      <section className="chat-main">
        <SkeletonStack count={3} />
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="chat-main">
        <div className="error-state">
          <strong>无法加载会话</strong>
          <p>{loadError ?? '会话不存在或已被移除。'}</p>
        </div>
      </section>
    );
  }

  const pair = participants.slice(0, 2);

  return (
    <section className="chat-main">
      <header className="chat-head">
        <div className="chat-head__title">
          <h2>{detail.title}</h2>
          <span className={`status ${statusClass(detail.status)}`}>{detail.status}</span>
        </div>
        <div className="chat-head__meta">
          <AgentStack agents={participants} size="sm" />
          {participants.length > 0 ? <small>{participants.length} 位 Agent</small> : null}
          {pair.length >= 2 ? (
            <small className="chat-head__bridge">{pair[0]!.name} ↔ {pair[1]!.name} 桥接中</small>
          ) : null}
        </div>
      </header>

      {detail.purpose ? <p className="chat-purpose">{detail.purpose}</p> : null}
      {sendError ? <p className="inline-error chat-send-error">{sendError}</p> : null}

      <ol className="chat-stream" ref={streamRef}>
        {messages.length === 0 && streamApprovals.length === 0 && streamRuns.length === 0 ? (
          <EmptyState title="还没有消息" detail="任务创建、Agent 交接和评审都会出现在这里。发条消息开始协作。" />
        ) : (
          <>
            <MeetingBubbles messages={messages} agentsById={agentsById} freshIds={freshIds} />
            {streamApprovals.map((workflow) => (
              <li key={workflow.workflowId} className="chat-card">
                <ApprovalCard
                  workflow={workflow}
                  task={runtime.tasks.find((task) => task.id === workflow.taskId)}
                  fresh={freshApprovalIds.has(workflow.workflowId)}
                  onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
                />
              </li>
            ))}
            {streamRuns.map((run) => (
              <li key={run.id} className="chat-card chat-card--run">
                <RunCard run={run} compact onSelect={onSelectRun} />
              </li>
            ))}
          </>
        )}
      </ol>

      <Composer
        key={meetingId}
        placeholder="给会话发一条消息，所有参与的 Agent 都会看到…"
        value={draft}
        onChange={(value) => { setDraft(value); setSendError(undefined); }}
        onSend={send}
        sending={sending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Room chat — center column for a cross-workspace group.
// ---------------------------------------------------------------------------

function RoomChat({
  config,
  roomId,
  detail,
  reload,
  activeWorkspaceId,
  streamConnected,
}: {
  config: RuntimeConfig;
  roomId: string;
  detail: RoomDetail | undefined;
  reload: () => void;
  activeWorkspaceId: string;
  streamConnected: boolean;
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

  if (!detail) {
    return (
      <section className="chat-main">
        <SkeletonStack count={3} />
      </section>
    );
  }

  return (
    <section className="chat-main">
      <header className="chat-head">
        <div className="chat-head__title">
          <h2>{detail.name}</h2>
          <span className={`room-live ${streamConnected ? 'room-live--on' : ''}`} title={streamConnected ? '实时推送已连接' : '实时推送未连接（低频轮询兜底）'}>
            <span className="room-live__dot" />{streamConnected ? '实时' : '轮询'}
          </span>
        </div>
        <div className="chat-head__meta">
          <small>{detail.members.length} 成员 · 跨工作区群聊</small>
        </div>
      </header>

      {detail.purpose ? <p className="chat-purpose">{detail.purpose}</p> : null}
      {sendError ? <p className="inline-error chat-send-error">{sendError}</p> : null}

      <ol className="chat-stream" ref={streamRef}>
        {typeof detail.totalMessages === 'number' && detail.totalMessages > detail.messages.length ? (
          <li className="chat-system">
            <span>只显示最近 {detail.messages.length} 条（共 {detail.totalMessages} 条）</span>
          </li>
        ) : null}
        {messages.length === 0 ? (
          <EmptyState title="还没有消息" detail="把不同项目的会话/Agent 拉进群，开始跨项目协作。" />
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
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Context panels — right column.
// ---------------------------------------------------------------------------

function AgentConnectionBadge({ active, cliAvailable }: { active: boolean; cliAvailable: boolean }) {
  const label = active ? '工作中' : cliAvailable ? 'CLI 已连通' : '已注册';
  const kind = active ? 'active' : cliAvailable ? 'ready' : 'idle';
  return (
    <span className={`agent-state agent-state--${kind}`}>
      <span className="agent-state__dot" />
      {label}
    </span>
  );
}

function cliAvailableFor(setup: SetupStatus | undefined, agentId: string): boolean {
  if (!setup) return false;
  const side = setup[agentId as 'claude' | 'codex'];
  return side?.cliAvailable ?? false;
}

function TaskForm({
  runtime,
  meetingId,
  onCancel,
  onCreated,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  meetingId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await runtime.createTaskInSession({
        title: trimmed,
        meetingId,
        ...(assignee ? { assignedTo: assignee } : {}),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <form className="task-create" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="任务标题，例如：实现 QR 登录接口"
        spellCheck={false}
        autoFocus
      />
      <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
        <option value="">指派给…</option>
        {runtime.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <button type="submit" className="button button--sm button--primary" disabled={busy || !title.trim()}>
        {busy ? '创建中…' : '创建'}
      </button>
      <button type="button" className="button button--sm button--ghost" onClick={onCancel} disabled={busy}>取消</button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}

function MeetingContextPanel({
  config,
  runtime,
  setup,
  meetingId,
  detail,
  reload,
  setDetail,
  selectedRun,
  onSelectRun,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
  setup?: SetupStatus;
  meetingId: string;
  detail: MeetingDetail | undefined;
  reload: () => void;
  setDetail: (updater: (current: MeetingDetail | undefined) => MeetingDetail | undefined) => void;
  selectedRun?: MesaAgentRun;
  onSelectRun: (run?: MesaAgentRun) => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [artifacts, setArtifacts] = useState<MesaArtifact[]>([]);
  const [expandedArtifact, setExpandedArtifact] = useState<string>();

  useEffect(() => {
    let active = true;
    loadArtifacts(config).then((all) => {
      if (!active) return;
      const taskIds = new Set(detail?.tasks ?? []);
      setArtifacts(all.filter((artifact) => artifact.meetingId === meetingId || (artifact.taskId && taskIds.has(artifact.taskId))));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [config, meetingId, detail?.tasks]);

  const agentsById = useMemo(
    () => new Map(runtime.agents.map((agent) => [agent.id, agent])),
    [runtime.agents],
  );
  const activeAgentIds = useMemo(
    () => new Set(runtime.activeRuns.map((run) => run.agentId)),
    [runtime.activeRuns],
  );
  // The newest running/pending run per agent — the visible "工作依据" behind the 工作中 badge.
  const runByAgent = useMemo(() => {
    const map = new Map<string, MesaAgentRun>();
    for (const run of runtime.runs) {
      if (run.status !== 'running' && run.status !== 'pending') continue;
      const prev = map.get(run.agentId);
      if (!prev || run.startedAt > prev.startedAt) map.set(run.agentId, run);
    }
    return map;
  }, [runtime.runs]);

  const participants = (detail?.agents ?? [])
    .map((id) => agentsById.get(id))
    .filter((agent): agent is MesaAgent => Boolean(agent));
  const uninvited = runtime.agents.filter((agent) => !(detail?.agents ?? []).includes(agent.id));
  const sessionTasks = (detail?.tasks ?? [])
    .map((id) => runtime.tasks.find((task) => task.id === id))
    .filter((task): task is MesaTask => Boolean(task));
  const meetingRuns = runtime.runs
    .filter((run) => (detail?.agents ?? []).includes(run.agentId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 6);

  const invite = async (agentId: string) => {
    setActionError(undefined);
    try {
      const updated = await runtime.inviteAgent(meetingId, agentId);
      setDetail((current) => ({ ...updated, messages: current?.messages ?? [] }));
      setInviteOpen(false);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeAgent = async (agentId: string) => {
    setActionError(undefined);
    try {
      const updated = await removeMeetingAgent(config, meetingId, agentId);
      setDetail((current) => ({ ...updated, messages: current?.messages ?? [] }));
      await runtime.refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeTaskStatus = async (taskId: string, status: string) => {
    setActionError(undefined);
    try {
      await updateTaskStatus(config, taskId, status);
      await runtime.refresh();
      reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeMeetingStatus = async (status: string) => {
    setActionError(undefined);
    try {
      await updateMeetingStatus(config, meetingId, status);
      await runtime.refresh();
      reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (!detail) {
    return <aside className="ctx-panel"><SkeletonStack count={2} compact /></aside>;
  }

  const open = detail.status !== 'archived' && detail.status !== 'completed' && detail.status !== 'closed';

  return (
    <aside className="ctx-panel">
      {actionError ? <p className="inline-error">{actionError}</p> : null}

      {selectedRun ? (
        <RunDetailView
          run={selectedRun}
          config={config}
          onClose={() => onSelectRun(undefined)}
          onCancelled={() => { void runtime.refresh(); onSelectRun(undefined); }}
        />
      ) : null}

      <section className="ctx-section">
        <div className="section-heading">
          <span>参与的 Agent</span>
          <small>{participants.length}</small>
          {uninvited.length > 0 && open ? (
            <button className="button button--ghost button--sm" onClick={() => setInviteOpen((value) => !value)} type="button" title="邀请即启动真实 CLI agent，其回复会写回会话">
              {inviteOpen ? '收起' : '邀请'}
            </button>
          ) : null}
        </div>
        {participants.length === 0 ? (
          <p className="ctx-hint">把 Agent 邀请进会话，它们就开始桥接协作。</p>
        ) : (
          <div className="ctx-members">
            {participants.map((agent) => (
              <div key={agent.id} className="ctx-member">
                <AgentMark agent={agent} size="md" />
                <div className="ctx-member__body">
                  <strong>{agent.name}</strong>
                  <span className="ctx-member__roles">{agent.roles.join(' · ')}</span>
                  <AgentConnectionBadge active={activeAgentIds.has(agent.id)} cliAvailable={cliAvailableFor(setup, agent.id)} />
                </div>
                {open ? (
                  <button
                    className="ctx-member__remove"
                    onClick={() => void removeAgent(agent.id)}
                    title="移出会话"
                    aria-label={`移出 ${agent.name}`}
                  >×</button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {inviteOpen && uninvited.length > 0 ? (
          <div className="agent-pick-row">
            {uninvited.map((agent) => (
              <button key={agent.id} className="agent-pick" onClick={() => void invite(agent.id)} type="button">
                <AgentMark agent={agent} size="sm" />
                <span>{agent.name}</span>
                <span className="agent-pick__add">加入</span>
              </button>
            ))}
          </div>
        ) : null}
        {open ? (
          <div className="ctx-actions">
            <button className="button button--sm button--ghost" onClick={() => void changeMeetingStatus('completed')}>结束会话</button>
            <button className="button button--sm button--ghost" onClick={() => void changeMeetingStatus('archived')}>归档</button>
          </div>
        ) : null}
      </section>

      <section className="ctx-section">
        <div className="section-heading">
          <span>任务</span>
          <small>{sessionTasks.length}</small>
          {open ? (
            <button className="button button--ghost button--sm" onClick={() => setTaskFormOpen((value) => !value)} type="button">
              {taskFormOpen ? '收起' : '新建'}
            </button>
          ) : null}
        </div>
        {taskFormOpen ? (
          <TaskForm
            runtime={runtime}
            meetingId={meetingId}
            onCancel={() => setTaskFormOpen(false)}
            onCreated={() => { setTaskFormOpen(false); reload(); }}
          />
        ) : null}
        {sessionTasks.length === 0 ? (
          <p className="ctx-hint">新建任务并指派 Agent，让会话开工。</p>
        ) : (
          <div className="task-list">
            {sessionTasks.map((task) => {
              const assignee = task.assignedTo ? agentsById.get(task.assignedTo) : undefined;
              return (
                <div key={task.id} className="task-row">
                  <select
                    className={`task-status-select ${statusClass(task.status)}`}
                    value={task.status}
                    onChange={(event) => void changeTaskStatus(task.id, event.target.value)}
                    aria-label={`${task.title} 状态`}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                  <div className="task-row__body">
                    <strong>{task.title}</strong>
                    {assignee ? <small>指派给 {assignee.name}</small> : <small>未指派</small>}
                  </div>
                  <span className="task-row__time">{formatTime(task.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ctx-section">
        <div className="section-heading">
          <span>运行</span>
          <small>{meetingRuns.length}</small>
        </div>
        {meetingRuns.length === 0 ? (
          <p className="ctx-hint">Agent 开始工作后，运行会出现在这里。</p>
        ) : (
          <div className="stack">
            {meetingRuns.map((run) => <RunCard key={run.id} run={run} compact onSelect={onSelectRun} />)}
          </div>
        )}
      </section>

      <section className="ctx-section">
        <div className="section-heading">
          <span>文件</span>
          <small>{artifacts.length}</small>
        </div>
        {artifacts.length === 0 ? (
          <p className="ctx-hint">任务产物（总结/报告/diff）会出现在这里。</p>
        ) : (
          <div className="artifact-list">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className="artifact-row"
                onClick={() => setExpandedArtifact((current) => current === artifact.id ? undefined : artifact.id)}
              >
                <span className="artifact-row__head">
                  <em className="artifact-row__kind">{artifact.kind.replaceAll('_', ' ')}</em>
                  <strong>{artifact.title ?? artifact.id}</strong>
                  <small>{artifact.createdBy} · {formatTime(artifact.createdAt)}</small>
                </span>
                {expandedArtifact === artifact.id ? (
                  <pre className="artifact-row__content">{artifact.content}</pre>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function RoomContextPanel({
  config,
  detail,
  reload,
  workspaces,
}: {
  config: RuntimeConfig;
  detail: RoomDetail | undefined;
  reload: () => void;
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [pickWs, setPickWs] = useState('');
  const [pickKind, setPickKind] = useState<'session' | 'agent'>('session');
  const [pickItems, setPickItems] = useState<Array<{ ref: string; label: string }>>([]);
  const [error, setError] = useState<string>();

  const wsNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const loadPickItems = async (workspaceId: string, kind: 'session' | 'agent' = pickKind) => {
    setPickWs(workspaceId);
    setError(undefined);
    try {
      if (kind === 'session') {
        const meetings = await loadWorkspaceMeetings(config, workspaceId);
        setPickItems(meetings.map((m) => ({ ref: m.id, label: m.title })));
      } else {
        const agents = await loadWorkspaceAgents(config, workspaceId);
        setPickItems(agents.map((a) => ({ ref: a.id, label: a.name })));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPickItems([]);
    }
  };

  const switchKind = async (kind: 'session' | 'agent') => {
    setPickKind(kind);
    setPickItems([]);
    if (pickWs) await loadPickItems(pickWs, kind);
  };

  const invite = async (member: { workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string; label?: string }) => {
    if (!detail) return;
    try {
      await inviteRoomMember(config, detail.id, member);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeMember = async (member: RoomMember) => {
    if (!detail) return;
    try {
      await leaveRoomMember(config, detail.id, {
        workspaceId: member.workspaceId,
        kind: member.kind,
        ref: member.ref,
      });
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (!detail) {
    return <aside className="ctx-panel"><SkeletonStack count={2} compact /></aside>;
  }

  return (
    <aside className="ctx-panel">
      {error ? <p className="inline-error">{error}</p> : null}

      <section className="ctx-section">
        <div className="section-heading">
          <span>成员</span>
          <small>{detail.members.length}</small>
        </div>
        {detail.members.length === 0 ? (
          <p className="ctx-hint">还没有成员，从右侧工作区拉人进群。</p>
        ) : (
          <div className="ctx-members">
            {detail.members.map((member) => (
              <div key={`${member.workspaceId}:${member.kind}:${member.ref}`} className="ctx-member">
                <span className={`agent-mark agent-mark--md room-mark room-mark--${member.kind}`}>
                  {(member.label ?? member.ref).slice(0, 1)}
                </span>
                <div className="ctx-member__body">
                  <strong>{member.label ?? member.ref}</strong>
                  <span className="ctx-member__roles">
                    {memberKindLabels[member.kind]} · {wsNameById.get(member.workspaceId) ?? member.workspaceId}
                  </span>
                </div>
                <button
                  type="button"
                  className="ctx-member__remove"
                  title={`把 ${member.label ?? member.ref} 移出群聊`}
                  aria-label={`把 ${member.label ?? member.ref} 移出群聊`}
                  onClick={() => void removeMember(member)}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ctx-section">
        <div className="section-heading"><span>拉群</span></div>
        <div className="rooms-invite">
          <label className="rooms-invite__field">
            <span>选择工作区</span>
            <select value={pickWs} onChange={(event) => { if (event.target.value) void loadPickItems(event.target.value); }}>
              <option value="">选择…</option>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
          <label className="rooms-invite__field">
            <span>成员类型</span>
            <select value={pickKind} onChange={(event) => void switchKind(event.target.value as 'session' | 'agent')}>
              <option value="session">会话</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          {pickItems.length > 0 ? (
            <div className="agent-pick-row">
              {pickItems.map((item) => (
                <button
                  key={item.ref}
                  className="agent-pick"
                  onClick={() => void invite({ workspaceId: pickWs, kind: pickKind, ref: item.ref, label: item.label })}
                >
                  <span>{item.label}</span>
                  <span className="agent-pick__add">拉入</span>
                </button>
              ))}
            </div>
          ) : pickWs ? (
            <p className="rooms-invite__hint">{pickKind === 'session' ? '该工作区暂无会话。' : '该工作区暂无 Agent。'}</p>
          ) : null}
        </div>
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Create views — shown in the center column (IM grammar: composing happens
// where the conversation will live).
// ---------------------------------------------------------------------------

function CreateSessionView({
  runtime,
  onCreated,
  onCancel,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  onCreated: (meetingId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggleAgent = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const meeting = await runtime.createSession({
        title: trimmed,
        purpose: purpose.trim() || undefined,
        agents: picked,
      });
      onCreated(meeting.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <section className="chat-main">
      <form className="create-view" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2>新建会话</h2>
        <p className="create-view__hint">把两个 Agent 放进同一会话，它们就开始桥接协作。</p>
        <label className="create-field">
          <span>会话标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：登录模块重构"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="create-field">
          <span>目的（可选）</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="这次会话要协作完成什么"
            spellCheck={false}
          />
        </label>
        <div className="create-field">
          <span>邀请 Agent</span>
          {runtime.agents.length === 0 ? (
            <p className="ctx-hint">
              还没有注册 Agent——先去「部署」页登记 Agent 身份，或执行 <code>mesa agent add &lt;id&gt; &lt;name&gt;</code>。
            </p>
          ) : (
            <div className="agent-pick-row">
              {runtime.agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`agent-pick ${picked.includes(agent.id) ? 'agent-pick--on' : ''}`}
                  onClick={() => toggleAgent(agent.id)}
                >
                  <AgentMark agent={agent} size="sm" />
                  <span>{agent.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="create-view__actions">
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button type="submit" className="button button--primary" disabled={busy || !title.trim()}>
            {busy ? '创建中…' : '创建会话'}
          </button>
        </div>
      </form>
    </section>
  );
}

function CreateRoomView({
  config,
  onCreated,
  onCancel,
}: {
  config: RuntimeConfig;
  onCreated: (roomId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const room = await createRoom(config, {
        name: trimmed,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      });
      onCreated(room.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <section className="chat-main">
      <form className="create-view" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2>新建群聊</h2>
        <p className="create-view__hint">跨工作区群聊：把不同项目的会话和 Agent 拉进同一个房间。</p>
        <label className="create-field">
          <span>群聊名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：发布评审"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="create-field">
          <span>主题/目的（可选）</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="例如：评审 7 月版登录重构"
            spellCheck={false}
          />
        </label>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="create-view__actions">
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            {busy ? '创建中…' : '建群'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Conversation list — left column. Meetings + rooms unified, sorted by last
// activity, unread badges driven by the shell-level unread store.
// ---------------------------------------------------------------------------

type ConvRow =
  | { kind: 'meeting'; id: string; meeting: MesaMeeting; sortAt: string; unread: number }
  | { kind: 'room'; id: string; room: RoomSummary; sortAt: string; unread: number };

function ConversationList({
  runtime,
  rooms,
  unread,
  activeKey,
  onOpen,
  onCreateSession,
  onCreateRoom,
  onOpenDeploy,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  rooms: RoomSummary[];
  unread: Record<string, number>;
  activeKey?: string;
  onOpen: (key: string) => void;
  onCreateSession: () => void;
  onCreateRoom: () => void;
  onOpenDeploy: () => void;
}) {
  const agentsById = useMemo(
    () => new Map(runtime.agents.map((agent) => [agent.id, agent])),
    [runtime.agents],
  );

  const rows = useMemo<ConvRow[]>(() => {
    const meetings: ConvRow[] = runtime.meetings.map((meeting) => ({
      kind: 'meeting',
      id: meeting.id,
      meeting,
      sortAt: meeting.updatedAt,
      unread: unread[`meeting:${meeting.id}`] ?? 0,
    }));
    const roomRows: ConvRow[] = rooms.map((room) => ({
      kind: 'room',
      id: room.id,
      room,
      sortAt: room.lastMessageAt ?? room.createdAt,
      unread: unread[`room:${room.id}`] ?? 0,
    }));
    return [...meetings, ...roomRows].sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  }, [runtime.meetings, rooms, unread]);

  const totalUnread = rows.reduce((sum, row) => sum + row.unread, 0);

  return (
    <aside className="conv-list no-drag">
      <div className="conv-list__head">
        <div className="section-heading">
          <span>消息</span>
          <small>{rows.length}</small>
        </div>
        <div className="conv-list__create">
          <button className="button button--sm button--ghost" type="button" onClick={onCreateSession}>＋ 会话</button>
          <button className="button button--sm button--ghost" type="button" onClick={onCreateRoom}>＋ 群聊</button>
        </div>
      </div>

      <div className="conv-list__rows">
        {!runtime.loaded ? (
          <SkeletonStack count={3} compact />
        ) : rows.length === 0 ? (
          <EmptyState title="还没有会话" detail="新建会话或群聊，把 Agent 拉进来开始协作。" />
        ) : (
          rows.map((row) => {
            const key = `${row.kind}:${row.id}`;
            const active = key === activeKey;
            if (row.kind === 'meeting') {
              const participants = (row.meeting.agents ?? [])
                .map((id) => agentsById.get(id))
                .filter((agent): agent is MesaAgent => Boolean(agent));
              return (
                <button
                  key={key}
                  type="button"
                  className={`conv-row ${active ? 'conv-row--active' : ''}`}
                  onClick={() => onOpen(key)}
                >
                  <span className="conv-row__avatar"><AgentStack agents={participants} size="sm" /></span>
                  <span className="conv-row__body">
                    <span className="conv-row__top">
                      <strong>{row.meeting.title}</strong>
                      <small>{formatTime(row.meeting.updatedAt)}</small>
                    </span>
                    <span className="conv-row__bottom">
                      <small>{row.meeting.purpose ?? `${row.meeting.tasks.length} 个任务`}</small>
                      {row.unread > 0 ? <span className="unread-badge">{row.unread > 99 ? '99+' : row.unread}</span> : null}
                    </span>
                  </span>
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                className={`conv-row ${active ? 'conv-row--active' : ''}`}
                onClick={() => onOpen(key)}
              >
                <span className="conv-row__avatar conv-row__avatar--room"><RoomGlyph /></span>
                <span className="conv-row__body">
                  <span className="conv-row__top">
                    <strong>{row.room.name}</strong>
                    <small>{formatTime(row.sortAt)}</small>
                  </span>
                  <span className="conv-row__bottom">
                    <small>{row.room.lastMessagePreview ?? `${row.room.members.length} 成员`}</small>
                    {row.unread > 0 ? <span className="unread-badge">{row.unread > 99 ? '99+' : row.unread}</span> : null}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="conv-list__foot">
        <button
          type="button"
          className={`conv-deploy ${totalUnread === 0 ? '' : 'conv-deploy--quiet'}`}
          onClick={onOpenDeploy}
          title="Agent CLI 集成与运行后端配置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          部署与集成
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// ChatShell — the IM outer shell: titlebar / 会话列表 / 聊天主区 / 上下文面板.
// Owns the two live streams: the shared global event stream (inside
// useMesaRuntime) and ONE room stream for every room.
// ---------------------------------------------------------------------------

function ChatShell({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const initialRoute = parseHashRoute();
  const [section, setSection] = useState<Section>(initialRoute.section);
  const [sessionId, setSessionId] = useState<string | undefined>(initialRoute.sessionId);
  const [roomId, setRoomId] = useState<string | undefined>(initialRoute.roomId);
  const [setup, setSetup] = useState<SetupStatus>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [roomStreamConnected, setRoomStreamConnected] = useState(false);
  const [roomVersion, setRoomVersion] = useState(0);
  const [selectedRun, setSelectedRun] = useState<MesaAgentRun>();

  // Hash is the single source of truth; navigation writes a hash, `hashchange`
  // applies it back so browser back/forward and deep links work.
  const applyRoute = useCallback((route: HashRoute) => {
    setSection(route.section);
    setSessionId(route.sessionId);
    setRoomId(route.roomId);
  }, []);

  useEffect(() => {
    const onHash = () => applyRoute(parseHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [applyRoute]);

  const go = useCallback((hash: string, route: HashRoute) => {
    if (window.location.hash === hash) {
      applyRoute(route); // same hash → apply directly (no hashchange fires)
      return;
    }
    window.location.hash = hash;
  }, [applyRoute]);

  const openConversation = useCallback((key: string) => {
    if (key.startsWith('meeting:')) {
      const id = key.slice('meeting:'.length);
      go(`#/sessions/${id}`, { section: 'sessions', sessionId: id });
    } else if (key.startsWith('room:')) {
      const id = key.slice('room:'.length);
      go(`#/rooms/${id}`, { section: 'rooms', roomId: id });
    }
  }, [go]);

  const openKey = section === 'sessions' && sessionId
    ? `meeting:${sessionId}`
    : section === 'rooms' && roomId
      ? `room:${roomId}`
      : undefined;

  useEffect(() => {
    loadSetupStatus(config).then(setSetup).catch(() => undefined);
  }, [config]);

  const refreshRooms = useCallback(() => {
    loadRooms(config).then(setRooms).catch(() => undefined);
  }, [config]);

  useEffect(() => refreshRooms(), [refreshRooms]);

  useEffect(() => {
    loadWorkspaces(config)
      .then((state) => {
        setWorkspaces(state.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })));
        setActiveWorkspaceId(state.activeWorkspaceId ?? '');
      })
      .catch(() => undefined);
  }, [config]);

  // Live room stream (SSE #2 — the only one besides the shared global stream):
  // a message in a closed room bumps its unread; a message in the open room
  // just refreshes the timeline. Room list previews update too.
  useEffect(() => {
    const stream = createRoomEventStream(
      config,
      (event) => {
        const key = `room:${event.roomId}`;
        if (openKey === key) {
          setUnread((prev) => ({ ...prev, [key]: 0 }));
          setRoomVersion((version) => version + 1);
        } else {
          setUnread((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
        }
        refreshRooms();
      },
      () => setRoomStreamConnected(true),
      () => setRoomStreamConnected(false),
    );
    return () => stream.close();
  }, [config, openKey, refreshRooms]);

  // Meeting unread: count live message_sent events for meetings that are not
  // open. Baseline = the newest event at mount; only live arrivals count.
  const seenEventCursorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const events = runtime.events;
    if (events.length === 0) return;
    const lastCursor = events[events.length - 1]!.cursor;
    if (seenEventCursorRef.current === undefined) {
      seenEventCursorRef.current = lastCursor;
      return;
    }
    if (seenEventCursorRef.current === lastCursor) return;
    const bumps: Record<string, number> = {};
    for (let i = events.length - 1; i >= 0; i--) {
      const envelope = events[i]!;
      if (envelope.cursor === seenEventCursorRef.current) break;
      const evt = envelope.event;
      if (evt.type === 'message_sent' && evt.meetingId) {
        const key = `meeting:${evt.meetingId}`;
        if (key !== openKey) bumps[key] = (bumps[key] ?? 0) + 1;
      }
    }
    seenEventCursorRef.current = lastCursor;
    if (Object.keys(bumps).length > 0) {
      setUnread((prev) => {
        const next = { ...prev };
        for (const [key, count] of Object.entries(bumps)) {
          next[key] = (next[key] ?? 0) + count;
        }
        return next;
      });
    }
  }, [runtime.events, openKey]);

  // Opening a conversation marks it read.
  useEffect(() => {
    if (!openKey) return;
    setUnread((prev) => (prev[openKey] ? { ...prev, [openKey]: 0 } : prev));
  }, [openKey]);

  const meeting = useMeetingDetail(config, section === 'sessions' ? sessionId : undefined, runtime.events);
  const room = useRoomDetail(config, section === 'rooms' ? roomId : undefined, roomVersion);

  const openMeetingId = section === 'sessions' ? sessionId : undefined;
  const openRoomId = section === 'rooms' ? roomId : undefined;

  return (
    <main className={`chat-shell ${openMeetingId || openRoomId ? '' : 'chat-shell--noctx'}`}>
      <header className="titlebar draggable">
        <div className="titlebar__brand">
          <span className="brand-mark">M</span>
          <span>AgentMesa</span>
        </div>
        <div className="titlebar__workspace no-drag">
          <WorkspaceSwitcher config={config} />
        </div>
        <div className="titlebar__right no-drag">
          <ConnectionBadge state={runtime.connection} />
          <div className="window-controls">
            <button type="button" aria-label="最小化" onClick={() => window.agentmesa?.minimizeMain()}>−</button>
            <button type="button" aria-label="最大化" onClick={() => window.agentmesa?.toggleMaximizeMain()}>□</button>
            <button type="button" aria-label="关闭" onClick={() => window.agentmesa?.closeMain()}>×</button>
          </div>
        </div>
      </header>

      <ConversationList
        runtime={runtime}
        rooms={rooms}
        unread={unread}
        activeKey={openKey}
        onOpen={openConversation}
        onCreateSession={() => go('#/sessions/new', { section: 'sessions-new' })}
        onCreateRoom={() => go('#/rooms/new', { section: 'rooms-new' })}
        onOpenDeploy={() => go('#/deploy', { section: 'deploy' })}
      />

      {section === 'deploy' ? (
        <section className="chat-main chat-main--page">
          {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}
          <DeployView config={config} />
        </section>
      ) : section === 'sessions-new' ? (
        <CreateSessionView
          runtime={runtime}
          onCreated={(id) => go(`#/sessions/${id}`, { section: 'sessions', sessionId: id })}
          onCancel={() => go('#/', { section: 'home' })}
        />
      ) : section === 'rooms-new' ? (
        <CreateRoomView
          config={config}
          onCreated={(id) => { void refreshRooms(); go(`#/rooms/${id}`, { section: 'rooms', roomId: id }); }}
          onCancel={() => go('#/', { section: 'home' })}
        />
      ) : openMeetingId ? (
        <MeetingChat
          config={config}
          runtime={runtime}
          meetingId={openMeetingId}
          detail={meeting.detail}
          loading={meeting.loading}
          loadError={meeting.error}
          reload={() => meeting.reload()}
          selectedRun={selectedRun}
          onSelectRun={setSelectedRun}
        />
      ) : openRoomId ? (
        <RoomChat
          config={config}
          roomId={openRoomId}
          detail={room.detail}
          reload={() => room.reload()}
          activeWorkspaceId={activeWorkspaceId}
          streamConnected={roomStreamConnected}
        />
      ) : (
        <section className="chat-main">
          {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}
          <EmptyState
            title="选择或开始一个会话"
            detail="左侧是会话与群聊列表。新建会话把 Agent 拉进同一张工作台，或建群做跨项目协作。"
            action={{ label: '新建会话', onClick: () => go('#/sessions/new', { section: 'sessions-new' }) }}
          />
        </section>
      )}

      {openMeetingId ? (
        <MeetingContextPanel
          config={config}
          runtime={runtime}
          setup={setup}
          meetingId={openMeetingId}
          detail={meeting.detail}
          reload={() => meeting.reload()}
          setDetail={meeting.setDetail}
          selectedRun={selectedRun}
          onSelectRun={setSelectedRun}
        />
      ) : openRoomId ? (
        <RoomContextPanel
          config={config}
          detail={room.detail}
          reload={() => room.reload()}
          workspaces={workspaces}
        />
      ) : null}

      <footer className="statusbar">
        <ConnectionBadge state={runtime.connection} />
        <span>{runtime.runs.length} 个运行 · {runtime.waiting.length} 个待审批 · {runtime.workflows.length} 个工作流</span>
        <span>AgentMesa 桌面版</span>
      </footer>
    </main>
  );
}

export function App() {
  const config = useMemo(readConfig, []);
  return config.view === 'widget' ? <WidgetView config={config} /> : <ChatShell config={config} />;
}
