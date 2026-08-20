import { useEffect, useMemo, useState } from 'react';
import type { MesaAgent, MesaAgentRun, MesaArtifact, MesaTask, RoomMember } from '@agentmesa/protocol';
import {
  inviteRoomMember,
  leaveRoomMember,
  loadArtifacts,
  loadWorkspaceAgents,
  loadWorkspaceMeetings,
  removeMeetingAgent,
  updateMeetingStatus,
  updateTaskStatus,
} from '../../api.js';
import type { MeetingDetail, RoomDetail, RuntimeConfig } from '../../types.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import type { SetupStatus } from '../../api.js';
import { AgentConnectionBadge, TASK_STATUSES, statusClass } from '../ui/badge.js';
import { formatTime, memberKindLabels } from '../ui/format.js';
import { Avatar } from '../ui/avatar.js';
import { Button } from '../ui/button.js';
import { IconButton } from '../ui/icon-button.js';
import { SkeletonStack } from '../ui/skeleton.js';
import { X } from '../ui/icons.js';
import { RunCard } from '../cards/run-card.js';
import { RunDetailView } from '../cards/run-detail-view.js';
import { TaskForm } from './task-form.js';

function cliAvailableFor(setup: SetupStatus | undefined, agentId: string): boolean {
  if (!setup) return false;
  const side = setup[agentId as 'claude' | 'codex'];
  return side?.cliAvailable ?? false;
}

function MeetingDrawerContent({
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

  if (!detail) return <SkeletonStack count={2} compact />;

  const open = detail.status !== 'archived' && detail.status !== 'completed' && detail.status !== 'closed';

  return (
    <>
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
            <Button
              small
              onClick={() => setInviteOpen((value) => !value)}
              title="邀请即启动真实 CLI agent，其回复会写回会话"
            >
              {inviteOpen ? '收起' : '邀请'}
            </Button>
          ) : null}
        </div>
        {participants.length === 0 ? (
          <p className="ctx-hint">把 Agent 邀请进会话，它们就开始桥接协作。</p>
        ) : (
          <div className="ctx-members">
            {participants.map((agent) => (
              <div key={agent.id} className="ctx-member">
                <Avatar name={agent.name} agentId={agent.id} roles={agent.roles} size="md" />
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
                <Avatar name={agent.name} agentId={agent.id} roles={agent.roles} size="sm" />
                <span>{agent.name}</span>
                <span className="agent-pick__add">加入</span>
              </button>
            ))}
          </div>
        ) : null}
        {open ? (
          <div className="ctx-actions">
            <Button small onClick={() => void changeMeetingStatus('completed')}>结束会话</Button>
            <Button small onClick={() => void changeMeetingStatus('archived')}>归档</Button>
          </div>
        ) : null}
      </section>

      <section className="ctx-section">
        <div className="section-heading">
          <span>任务</span>
          <small>{sessionTasks.length}</small>
          {open ? (
            <Button small onClick={() => setTaskFormOpen((value) => !value)}>
              {taskFormOpen ? '收起' : '新建'}
            </Button>
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
    </>
  );
}

function RoomDrawerContent({
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

  if (!detail) return <SkeletonStack count={2} compact />;

  return (
    <>
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
                <Avatar
                  name={member.label ?? member.ref}
                  agentId={`${member.workspaceId}:${member.ref}`}
                  kind={member.kind === 'agent' ? 'agent' : 'human'}
                  size="md"
                />
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
            <select value={pickKind} onChange={(event) => { void switchKind(event.target.value as 'session' | 'agent'); }}>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// StatusDrawer — the right context panel as a third layout column.
// NOTE: an absolutely-positioned overlay drawer made the transparent desktop
// window drop the chat-stream paint layer (Chromium compositing bug); a
// layout column sidesteps it and matches the inspector-panel grammar.
// ---------------------------------------------------------------------------

export function StatusDrawer({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside id="status-drawer" className="status-drawer">
      <header>
        <div>
          <strong>会话状态</strong>
          <span>{title}</span>
        </div>
        <IconButton label="关闭状态栏" onClick={onClose}><X size={16} /></IconButton>
      </header>
      <div className="ctx-panel">
        {children}
      </div>
    </aside>
  );
}

export { MeetingDrawerContent, RoomDrawerContent };
