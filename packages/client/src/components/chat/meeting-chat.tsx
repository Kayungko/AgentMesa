import { useEffect, useMemo, useRef, useState } from 'react';
import type { MesaAgent, MesaAgentRun } from '@agentmesa/protocol';
import { postMeetingMessage } from '../../api.js';
import type { MeetingDetail, RuntimeConfig } from '../../types.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { useFreshMembers } from '../ui/use-fresh-members.js';
import { ApprovalCard } from '../cards/approval-card.js';
import { RunCard } from '../cards/run-card.js';
import { collectRunActivity } from '../../run-activity.js';
import { ChatHeader } from './chat-header.js';
import { Composer } from './composer.js';
import { MeetingBubbles } from './bubbles.js';
import { ChatEmpty, ChatErrorState, ChatLoading } from './empty.js';

export function MeetingChat({
  config,
  runtime,
  meetingId,
  detail,
  loading,
  loadError,
  reload,
  onSelectRun,
  onOpenDrawer,
  onStub,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
  meetingId: string;
  detail: MeetingDetail | undefined;
  loading: boolean;
  loadError: string | undefined;
  reload: () => void;
  onSelectRun: (run: MesaAgentRun) => void;
  onOpenDrawer: () => void;
  onStub?: (label: string) => void;
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

  // Audit trail: how session runs in this meeting were driven (deep driver
  // vs CLI) and every permission verdict the guard made. Derived from the
  // live event stream, so it updates as turns progress.
  const runActivity = useMemo(
    () => collectRunActivity(runtime.events, meetingId),
    [runtime.events, meetingId],
  );

  // Approvals that arrive while this meeting is open enter with the shared
  // msg-in animation; cards already present on first render are the baseline
  // and never animate.
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

  if (loading && !detail) return <ChatLoading />;
  if (!detail) return <ChatErrorState message={loadError} />;

  const pair = participants.slice(0, 2);

  return (
    <section className="chat-main">
      <ChatHeader
        kind="meeting"
        title={detail.title}
        status={detail.status}
        participants={participants}
        bridge={pair.length >= 2 ? `${pair[0]!.name} ↔ ${pair[1]!.name} 桥接中` : undefined}
        onOpenDrawer={onOpenDrawer}
      />

      {detail.purpose ? <p className="chat-purpose">{detail.purpose}</p> : null}
      {sendError ? <p className="inline-error chat-send-error">{sendError}</p> : null}

      <ol className="chat-stream" ref={streamRef}>
        {messages.length === 0 && streamApprovals.length === 0 && streamRuns.length === 0 && runActivity.length === 0 ? (
          <ChatEmpty title="还没有消息" detail="任务创建、Agent 交接和评审都会出现在这里。发条消息开始协作。" />
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
            {runActivity.map((item) => (
              <li key={item.id} className={`chat-activity chat-activity--${item.kind}`}>
                {item.label}
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
        onStub={onStub}
      />
    </section>
  );
}
