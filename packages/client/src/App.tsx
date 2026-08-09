import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventEnvelope, MesaAgent, MesaAgentRun, MesaMeeting, MesaMessage, MesaRoom, MesaTask, MesaWorkspace, RoomMember, RoomMessage } from '@agentmesa/protocol';
import { useMesaRuntime, type ConnectionState } from './useMesaRuntime.js';
import {
  activateWorkspace,
  createEventStream,
  createRoom,
  installIntegration,
  inviteRoomMember,
  leaveRoomMember,
  loadAgents,
  loadMeeting,
  loadRoom,
  loadRooms,
  loadSetupStatus,
  createRoomEventStream,
  loadWorkspaces,
  loadWorkspaceAgents,
  loadWorkspaceMeetings,
  postMeetingMessage,
  registerAgent,
  registerWorkspace,
  removeWorkspace,
  saveRunnerCommands,
  sendRoomMessage,
  uninstallIntegration,
  updateMeetingStatus,
  updateRunStatus,
  updateTaskStatus,
  removeMeetingAgent,
  type IntegrationSide,
  type RoomSummary,
  type RunnerSource,
  type SetupStatus,
} from './api.js';
import type { RoomDetail } from './types.js';
import type { MeetingDetail, RuntimeConfig, WorkflowState, WorkspaceList } from './types.js';
import './styles.css';

function readConfig(): RuntimeConfig {
  const params = new URLSearchParams(window.location.search);
  return {
    baseUrl: params.get('baseUrl') ?? 'http://127.0.0.1:3456',
    token: params.get('token') ?? undefined,
    view: params.get('view') === 'widget' ? 'widget' : 'main',
  };
}

const connectionLabels: Record<ConnectionState, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重新连接中',
  offline: '离线',
};

function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection connection--${state}`}>
      <span className="connection__dot" />
      {connectionLabels[state]}
    </span>
  );
}

const runStateLabels: Record<string, string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function ProgressBar({ run }: { run: MesaAgentRun }) {
  // No fake percentage — a hardcoded 56%/12% misleads on real progress. Render
  // a deterministic state indicator instead; real progress needs runner-reported
  // progress fields, which the protocol does not carry yet.
  const label = runStateLabels[run.status] ?? run.status;
  return (
    <div className={`progress progress--${run.status}`} role="status" aria-label={label}>
      <span className="progress__label">{label}</span>
    </div>
  );
}

function RunCard({ run, compact = false, onSelect }: { run: MesaAgentRun; compact?: boolean; onSelect?: (run: MesaAgentRun) => void }) {
  return (
    <button
      className={`run-card ${compact ? 'run-card--compact' : ''}`}
      onClick={() => onSelect?.(run)}
      type="button"
    >
      <div className="run-card__topline">
        <span className="run-card__agent">{run.agentId}</span>
        <span className={`status status--${run.status}`}>{run.status}</span>
      </div>
      <strong>{run.outputSummary || run.input || run.action}</strong>
      <ProgressBar run={run} />
    </button>
  );
}

function ApprovalCard({
  workflow,
  task,
  onDecide,
}: {
  workflow: WorkflowState;
  task?: MesaTask;
  onDecide: (decision: 'approve' | 'reject', message?: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (decision: 'approve' | 'reject') => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onDecide(decision, message.trim() || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="approval-card">
      <div className="approval-card__heading">
        <span className="attention-dot" />
        <div>
          <small>需要你的决策 · 步骤 {workflow.currentStep}</small>
          <strong>{task?.title ?? workflow.taskId}</strong>
          <span className="approval-card__taskid">{workflow.taskId}</span>
        </div>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="为 Agent 补充上下文"
        rows={2}
      />
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="approval-card__actions">
        <button disabled={submitting} className="button button--ghost" onClick={() => submit('reject')}>
          拒绝
        </button>
        <button disabled={submitting} className="button button--primary" onClick={() => submit('approve')}>
          批准
        </button>
      </div>
    </article>
  );
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty-state">
      <svg className="empty-state__mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M18 45 V28 H26 L32 37 L38 28 H46 V45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? (
        <button type="button" className="button button--primary empty-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function SkeletonStack({ count, compact = false }: { count: number; compact?: boolean }) {
  return (
    <div className="stack">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton ${compact ? 'skeleton--compact' : ''}`} />
      ))}
    </div>
  );
}

function RailIcon({ kind }: { kind: 'overview' | 'runs' | 'workflows' | 'sessions' | 'rooms' | 'deploy' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (kind === 'overview') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="2" y="2" width="6" height="6" rx="1.5" {...common} />
        <rect x="10" y="2" width="6" height="6" rx="1.5" {...common} />
        <rect x="2" y="10" width="6" height="6" rx="1.5" {...common} />
        <rect x="10" y="10" width="6" height="6" rx="1.5" {...common} />
      </svg>
    );
  }
  if (kind === 'runs') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M10 2 L4 10 H9 L8 16 L14 8 H9 Z" {...common} />
      </svg>
    );
  }
  if (kind === 'sessions') {
    // Two agents joined through one meeting: the bridge.
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="5.5" cy="5" r="2.3" {...common} />
        <circle cx="12.5" cy="13" r="2.3" {...common} />
        <path d="M7 6.6 L11 11.2 M5.5 8 V12.2 M5.5 12.2 C7.6 12.2 11 12.2 12.5 12.2" {...common} />
      </svg>
    );
  }
  if (kind === 'rooms') {
    // A group chat: speech bubbles joined around a common stream.
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M4 5.5 h10 a1.4 1.4 0 0 1 1.4 1.4 v4.2 a1.4 1.4 0 0 1 -1.4 1.4 h-6.2 l-3 2.4 v-2.4 h-0.8 a1.4 1.4 0 0 1 -1.4 -1.4 v-4.2 a1.4 1.4 0 0 1 1.4 -1.4 z" {...common} />
        <circle cx="6.3" cy="8.5" r="0.8" {...common} />
        <circle cx="9" cy="8.5" r="0.8" {...common} />
        <circle cx="11.7" cy="8.5" r="0.8" {...common} />
      </svg>
    );
  }
  if (kind === 'deploy') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          {...common}
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="5" cy="4" r="2" {...common} />
      <circle cx="5" cy="14" r="2" {...common} />
      <circle cx="13" cy="9" r="2" {...common} />
      <path d="M5 6 V12 M6.5 5.2 L11 8 M6.5 12.8 L11 10" {...common} />
    </svg>
  );
}

function WidgetView({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const [expanded, setExpanded] = useState(false);
  const focusRun = runtime.activeRuns[0];

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    await window.agentmesa?.setWidgetExpanded(next);
  };

  if (!expanded) {
    return (
      <main className="widget-shell widget-shell--collapsed">
        <button className="widget-summary" type="button" onClick={toggle}>
          <span className="brand-mark">M</span>
          <span className="widget-summary__copy">
            <strong>{runtime.waiting.length > 0 ? `${runtime.waiting.length} 个审批待处理` : focusRun ? focusRun.agentId : 'AgentMesa 就绪'}</strong>
            <small>{focusRun ? focusRun.action : connectionLabels[runtime.connection]}</small>
          </span>
          <span className="widget-summary__count">{runtime.activeRuns.length}</span>
        </button>
      </main>
    );
  }

  return (
    <main className="widget-shell widget-shell--expanded">
      <header className="widget-header draggable">
        <div>
          <span className="eyebrow">AgentMesa 实时</span>
          <h1>Agent 活动</h1>
        </div>
        <div className="widget-header__actions no-drag">
          <ConnectionBadge state={runtime.connection} />
          <button className="icon-button" type="button" onClick={toggle} aria-label="收起">−</button>
          <button className="icon-button" type="button" onClick={() => window.agentmesa?.hideWidget()} aria-label="隐藏">×</button>
        </div>
      </header>

      <section className="widget-content">
        {runtime.error ? (
          <div className="error-state">
            <strong>连接中断</strong>
            <p>{runtime.error}</p>
            <button className="button button--primary" onClick={() => runtime.refresh()}>重试</button>
          </div>
        ) : null}

        {runtime.waiting.length > 0 ? (
          <div className="stack">
            {runtime.waiting.map((workflow) => (
              <ApprovalCard
                key={workflow.workflowId}
                workflow={workflow}
                task={runtime.tasks.find((task) => task.id === workflow.taskId)}
                onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
              />
            ))}
          </div>
        ) : null}

        <div className="section-heading">
          <span>正在运行</span>
          <small>{runtime.activeRuns.length}</small>
        </div>
        {!runtime.loaded ? (
          <SkeletonStack count={2} compact />
        ) : runtime.activeRuns.length > 0 ? (
          <div className="stack">
            {runtime.activeRuns.slice(0, 4).map((run) => <RunCard key={run.id} run={run} compact />)}
          </div>
        ) : (
          <EmptyState title="所有 Agent 空闲中" detail="新的运行和审批会自动出现在这里。" />
        )}
      </section>

      <footer className="widget-footer no-drag">
        <button type="button" onClick={() => window.agentmesa?.openMain('/')}>打开工作区</button>
        <span>最近 {runtime.events.length} 条事件</span>
      </footer>
    </main>
  );
}

type EventCategory = 'all' | 'run' | 'task' | 'meeting' | 'workflow' | 'message' | 'agent' | 'check';

const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  all: '全部',
  run: '运行',
  task: '任务',
  meeting: '会话',
  workflow: '工作流',
  message: '消息',
  agent: 'Agent',
  check: '检查',
};

function eventCategory(type: string): EventCategory {
  if (type.startsWith('agent_run_')) return 'run';
  if (type.startsWith('task_')) return 'task';
  if (type.startsWith('meeting_')) return 'meeting';
  if (type.startsWith('workflow_')) return 'workflow';
  if (type === 'message_sent' || type.startsWith('thread_')) return 'message';
  if (type.startsWith('agent_')) return 'agent';
  if (type.startsWith('check_')) return 'check';
  return 'all';
}

/** Whether an event can be opened into a detail view (run / workflow / session). */
function isEventNavigable(event: EventEnvelope['event']): boolean {
  const type = event.type;
  if (type.startsWith('agent_run_')) return true;
  if (type.startsWith('workflow_')) return true;
  if (type === 'message_sent') return Boolean(event.meetingId);
  if (type.startsWith('meeting_') || type.startsWith('task_')) return true;
  return false;
}

function EventRow({ envelope, onNavigate }: { envelope: EventEnvelope; onNavigate?: (envelope: EventEnvelope) => void }) {
  const title = envelope.event.type.replaceAll('_', ' ');
  const navigable = Boolean(onNavigate) && isEventNavigable(envelope.event);
  return (
    <li className="event-row">
      <button
        type="button"
        className={`event-row__main ${navigable ? 'event-row__main--link' : ''}`}
        onClick={() => navigable && onNavigate?.(envelope)}
        disabled={!navigable}
        title={navigable ? '查看详情' : undefined}
      >
        <span className={`event-row__marker event-row__marker--${envelope.event.streamType}`} />
        <div>
          <strong>{title}</strong>
          <small>{envelope.event.actor} · {new Date(envelope.event.timestamp).toLocaleTimeString()}</small>
        </div>
      </button>
    </li>
  );
}

const runnerSourceLabels: Record<RunnerSource, string> = {
  env: '环境变量',
  config: '工作区配置',
  stub: 'stub 演示模式',
};

const sideLabels: Record<IntegrationSide, { name: string; role: string }> = {
  claude: { name: 'Claude Code', role: 'builder · 实现与修复' },
  codex: { name: 'Codex', role: 'reviewer · 审核与测试' },
};

/** Agent 身份登记约定，与 `mesa agent add` 及 MCP 环境变量保持一致。 */
const sideAgentSpecs: Record<IntegrationSide, { id: string; name: string; client: string; roles: string[] }> = {
  claude: { id: 'agent:claude', name: 'Claude', client: 'claude', roles: ['builder'] },
  codex: { id: 'agent:codex', name: 'Codex', client: 'codex', roles: ['reviewer'] },
};

const memberKindLabels: Record<RoomMember['kind'], string> = {
  session: '会话',
  agent: 'Agent',
  human: '我',
};

/** Runner 命令的环境变量键；env 优先于工作区配置。 */
const runnerEnvKeys: Record<IntegrationSide, string> = {
  claude: 'AGENTMESA_CLAUDE_CMD',
  codex: 'AGENTMESA_CODEX_CMD',
};

function DeployCard({
  side,
  status,
  busy,
  error,
  registered,
  onAct,
  onRegister,
}: {
  side: IntegrationSide;
  status: SetupStatus;
  busy?: string;
  error?: string;
  registered?: boolean;
  onAct: (kind: 'install' | 'uninstall', side: IntegrationSide) => void;
  onRegister: () => void;
}) {
  const s = status[side];
  const busyInstall = busy === `install:${side}`;
  const busyUninstall = busy === `uninstall:${side}`;
  const busyRegister = busy === `register:${side}`;
  return (
    <article className="deploy-card">
      <div className="deploy-card__heading">
        <strong>{sideLabels[side].name}</strong>
        <small>{sideLabels[side].role}</small>
      </div>
      <div className="deploy-card__row">
        <span>CLI</span>
        <strong className={s.cliAvailable ? 'deploy-ok' : 'deploy-warn'}>
          {s.cliAvailable ? '可用' : '未检测到'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>MCP 服务器</span>
        <strong className={s.mcpInstalled ? 'deploy-ok' : 'deploy-warn'}>
          {s.mcpInstalled ? '已注册' : '未注册'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>Agent 身份</span>
        <strong className={registered ? 'deploy-ok' : 'deploy-warn'}>
          {registered ? '已登记' : '未登记'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>运行后端</span>
        <strong>{runnerSourceLabels[status.runnerSources[side]]}</strong>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="deploy-card__actions">
        <button
          className="button button--primary"
          disabled={!s.cliAvailable || s.mcpInstalled || busyInstall || busyUninstall}
          title={s.cliAvailable ? '写入 CLI 的用户级 MCP 配置' : '请先在本机安装该 CLI'}
          onClick={() => onAct('install', side)}
        >
          {busyInstall ? '安装中…' : '注册 MCP'}
        </button>
        <button
          className="button button--ghost"
          disabled={!s.mcpInstalled || busyInstall || busyUninstall}
          onClick={() => onAct('uninstall', side)}
        >
          {busyUninstall ? '移除中…' : '移除'}
        </button>
        <button
          className="button button--ghost"
          disabled={registered || busyRegister || busyInstall || busyUninstall}
          title={registered ? '该 Agent 已登记到当前工作区' : '把 Agent 身份登记到当前工作区，会话/群聊即可直接邀请'}
          onClick={onRegister}
        >
          {busyRegister ? '登记中…' : registered ? '已登记' : '登记 Agent 身份'}
        </button>
      </div>
    </article>
  );
}

function DeployView({ config }: { config: RuntimeConfig }) {
  const [status, setStatus] = useState<SetupStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [sideError, setSideError] = useState<{ side: IntegrationSide; message: string }>();
  const [busy, setBusy] = useState<string>();
  const [claudeCmd, setClaudeCmd] = useState('');
  const [codexCmd, setCodexCmd] = useState('');
  const [saved, setSaved] = useState(false);
  const [envWarnings, setEnvWarnings] = useState<string[]>([]);
  const [activeWs, setActiveWs] = useState<MesaWorkspace>();
  const [agents, setAgents] = useState<MesaAgent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadSetupStatus(config);
      setStatus(next);
      setClaudeCmd(next.runners.claudeCmd ?? '');
      setCodexCmd(next.runners.codexCmd ?? '');
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    loadWorkspaces(config)
      .then((state) => setActiveWs(state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)))
      .catch(() => undefined);
  }, [config]);

  useEffect(() => {
    loadAgents(config).then(setAgents).catch(() => undefined);
  }, [config]);

  const act = async (kind: 'install' | 'uninstall', side: IntegrationSide) => {
    setBusy(`${kind}:${side}`);
    setSideError(undefined);
    setSaved(false);
    try {
      if (kind === 'install') {
        await installIntegration(config, side);
      } else {
        await uninstallIntegration(config, side);
      }
      await refresh();
    } catch (reason) {
      setSideError({ side, message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  const saveRunners = async () => {
    setBusy('runners');
    setError(undefined);
    setSideError(undefined);
    setSaved(false);
    try {
      // If an env var pins the command for a side, the workspace config is
      // shadowed — warn rather than silently claiming the save took effect.
      const claudeTrimmed = claudeCmd.trim();
      const codexTrimmed = codexCmd.trim();
      const warnings: string[] = [];
      if (claudeTrimmed && status?.runnerSources.claude === 'env') {
        warnings.push(`环境变量 ${runnerEnvKeys.claude} 优先，工作区命令不会生效`);
      }
      if (codexTrimmed && status?.runnerSources.codex === 'env') {
        warnings.push(`环境变量 ${runnerEnvKeys.codex} 优先，工作区命令不会生效`);
      }
      setEnvWarnings(warnings);
      await saveRunnerCommands(config, {
        claudeCmd: claudeTrimmed || null,
        codexCmd: codexTrimmed || null,
      });
      await refresh();
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const registerSide = async (side: IntegrationSide) => {
    setBusy(`register:${side}`);
    setSideError(undefined);
    setSaved(false);
    try {
      const spec = sideAgentSpecs[side];
      await registerAgent(config, {
        id: spec.id,
        name: spec.name,
        client: spec.client,
        roles: spec.roles,
      });
      setAgents(await loadAgents(config));
    } catch (reason) {
      setSideError({ side, message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  if (!loading && error) {
    return (
      <div className="error-state">
        <strong>无法加载部署状态</strong>
        <p>{error}</p>
        <button className="button button--primary" onClick={() => { setLoading(true); void refresh(); }}>重试</button>
      </div>
    );
  }

  if (loading || !status) {
    return <SkeletonStack count={2} />;
  }

  return (
    <>
      <div className="deploy-mcp-scope">
        <span className="deploy-mcp-scope__dot" />
        <p>
          MCP 当前生效于：<strong>{activeWs ? activeWs.name : '当前工作区'}</strong>
          {activeWs ? `（${activeWs.rootDir}）` : ''}
          <small>切换工作区后，未固定 AGENTMESA_WORKSPACE 的 Agent 会话会跟随新的激活工作区。</small>
        </p>
        <button
          className="button button--sm button--ghost deploy-reprobe"
          onClick={() => { setLoading(true); void refresh(); }}
          disabled={busy === 'reprobe'}
          title="重新探测 CLI 与 MCP 注册状态"
        >
          重新探测
        </button>
      </div>

      <section className="content-block">
        <div className="section-heading">
          <span>Agent CLI 集成</span>
          <small>MCP 是连接通道，Agent 身份登记让会话/群聊立即可邀</small>
        </div>
        <p className="deploy-note">
          <strong>注册 MCP</strong> 让该 CLI 的会话能调用 mesa 工具；
          <strong>登记 Agent 身份</strong> 把该 Agent 写进当前工作区，新建会话与群聊拉人时可直接选中。
          CLI 未安装也可先登记身份，等会话上线后自动桥接。
        </p>
        <div className="deploy-grid">
          {(['claude', 'codex'] as const).map((side) => (
            <DeployCard
              key={side}
              side={side}
              status={status}
              busy={busy}
              error={sideError?.side === side ? sideError.message : undefined}
              registered={agents.some((agent) => agent.id === sideAgentSpecs[side].id)}
              onAct={act}
              onRegister={() => void registerSide(side)}
            />
          ))}
        </div>
      </section>

      <section className="content-block">
        <div className="section-heading">
          <span>运行后端命令</span>
          <small>工作区级配置（.agentmesa/config.json）——与用户级 MCP 注册相互独立</small>
        </div>
        <p className="deploy-note">
          MCP 注册写入 CLI 的用户级配置（<code>~/.claude.json</code> / <code>~/.codex/config.toml</code>），对每个 Agent 会话全局生效；
          这里的运行命令只作用于当前工作区，留空则回退到环境变量或 stub 演示模式。
        </p>
        <div className="deploy-form">
          <label>
            Claude 命令（builder）
            <input
              value={claudeCmd}
              onChange={(event) => { setClaudeCmd(event.target.value); setSaved(false); setEnvWarnings([]); }}
              placeholder="例如 claude -p"
              spellCheck={false}
            />
            {status.runnerSources.claude === 'env' ? (
              <span className="deploy-source-hint deploy-source-hint--warn">
                环境变量 {runnerEnvKeys.claude} 当前优先，工作区命令不会生效
              </span>
            ) : null}
          </label>
          <label>
            Codex 命令（reviewer）
            <input
              value={codexCmd}
              onChange={(event) => { setCodexCmd(event.target.value); setSaved(false); setEnvWarnings([]); }}
              placeholder="例如 codex exec -"
              spellCheck={false}
            />
            {status.runnerSources.codex === 'env' ? (
              <span className="deploy-source-hint deploy-source-hint--warn">
                环境变量 {runnerEnvKeys.codex} 当前优先，工作区命令不会生效
              </span>
            ) : null}
          </label>
          {envWarnings.length > 0 ? (
            <p className="deploy-source-hint deploy-source-hint--warn">
              {envWarnings.join('；')}
            </p>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {saved ? <p className="deploy-saved">已保存到工作区配置</p> : null}
          <div>
            <button className="button button--primary" disabled={busy === 'runners'} onClick={() => void saveRunners()}>
              {busy === 'runners' ? '保存中…' : '保存命令'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sessions — bridge agents into a shared meeting.
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function agentTone(agentId: string): string {
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tones = ['tone-violet', 'tone-mint', 'tone-amber', 'tone-coral'] as const;
  return tones[hash % tones.length]!;
}

// Task statuses a human can drive from the workspace (matching the protocol's
// canTransitionTaskStatus allowlist at the server layer).
const TASK_STATUSES = [
  'backlog', 'todo', 'in_progress', 'in_review', 'needs_fix', 'approved',
  'completed', 'blocked', 'cancelled',
] as const;

function statusClass(status: string): string {
  if (['active', 'open', 'running', 'pending', 'in_progress', 'in_review'].includes(status)) return 'status--running';
  if (['completed', 'approved', 'done'].includes(status)) return 'status--completed';
  if (['failed', 'blocked', 'archived', 'closed'].includes(status)) return 'status--failed';
  return 'status--idle';
}

function cliAvailableFor(setup: SetupStatus | undefined, agentId: string): boolean {
  if (!setup) return false;
  const side = setup[agentId as IntegrationSide];
  return side?.cliAvailable ?? false;
}

function AgentMark({ agent, size = 'md' }: { agent: MesaAgent; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`agent-mark agent-mark--${size} ${agentTone(agent.id)}`} title={`${agent.name} (${agent.id})`}>
      {initials(agent.name)}
    </span>
  );
}

function AgentStack({ agents, size = 'md' }: { agents: MesaAgent[]; size?: 'sm' | 'md' }) {
  if (agents.length === 0) {
    return <span className="agent-stack agent-stack--empty"><span className="agent-stack__none">尚无 Agent</span></span>;
  }
  const shown = agents.slice(0, 4);
  const extra = agents.length - shown.length;
  return (
    <span className="agent-stack">
      {shown.map((agent) => <AgentMark key={agent.id} agent={agent} size={size} />)}
      {extra > 0 ? <span className={`agent-mark agent-mark--extra agent-mark--${size}`}>+{extra}</span> : null}
    </span>
  );
}

function SessionCard({
  meeting,
  agentsById,
  activeAgentIds,
  onSelect,
}: {
  meeting: MesaMeeting;
  agentsById: Map<string, MesaAgent>;
  activeAgentIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const participants = (meeting.agents ?? [])
    .map((id) => agentsById.get(id))
    .filter((agent): agent is MesaAgent => Boolean(agent));
  const pair = participants.slice(0, 2);
  const busyCount = participants.filter((agent) => activeAgentIds.has(agent.id)).length;
  return (
    <button className="session-card" type="button" onClick={() => onSelect(meeting.id)}>
      <div className="session-card__top">
        <strong>{meeting.title}</strong>
        <span className={`status ${statusClass(meeting.status)}`}>{meeting.status}</span>
      </div>
      {meeting.purpose ? <p className="session-card__purpose">{meeting.purpose}</p> : null}
      <div className="session-card__meta">
        <span>{meeting.tasks.length} 个任务</span>
        <span>更新于 {formatTime(meeting.updatedAt)}</span>
      </div>
      <div className="session-card__foot">
        <AgentStack agents={participants} />
        {pair.length >= 2 ? (
          <span className="session-card__bridge">
            <span className="session-card__link" aria-hidden="true" />
            <span>{pair[0]!.name} ↔ {pair[1]!.name}</span>
            {busyCount > 0 ? <em>{busyCount} 活跃</em> : null}
          </span>
        ) : participants.length === 1 ? (
          <span className="session-card__bridge session-card__bridge--waiting">
            <span className="session-card__link session-card__link--solo" aria-hidden="true" />
            等待第二个 Agent 加入
          </span>
        ) : null}
      </div>
    </button>
  );
}

function CreateSessionForm({
  runtime,
  onCancel,
  onCreated,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  onCancel: () => void;
  onCreated: (meetingId: string) => void;
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
    <form className="session-create" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="session-create__grid">
        <label className="session-create__field">
          <span>会话标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：登录模块重构"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="session-create__field">
          <span>目的（可选）</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="这次会话要协作完成什么"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="session-create__field">
        <span>邀请 Agent</span>
        {runtime.agents.length === 0 ? (
          <p className="session-create__hint">
            还没有注册 Agent——先在「部署」页注册 MCP，或执行 <code>mesa agent add &lt;id&gt; &lt;name&gt;</code>。
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
      <div className="session-create__actions">
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>取消</button>
        <button type="submit" className="button button--primary" disabled={busy || !title.trim()}>
          {busy ? '创建中…' : '创建会话'}
        </button>
      </div>
    </form>
  );
}

function SessionListView({
  runtime,
  showCreate,
  onCreateToggle,
  onSelect,
  onCreated,
  onGoDeploy,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  showCreate: boolean;
  onCreateToggle: () => void;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onGoDeploy?: () => void;
}) {
  const agentsById = useMemo(
    () => new Map(runtime.agents.map((agent) => [agent.id, agent])),
    [runtime.agents],
  );
  const activeAgentIds = useMemo(
    () => new Set(runtime.activeRuns.map((run) => run.agentId)),
    [runtime.activeRuns],
  );
  const sorted = useMemo(
    () => [...runtime.meetings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [runtime.meetings],
  );
  const busyAgents = runtime.agents.filter((agent) => activeAgentIds.has(agent.id)).length;

  return (
    <>
      <div className="metric-grid">
        <article><small>会话</small><strong>{runtime.meetings.length}</strong></article>
        <article><small>注册 Agent</small><strong>{runtime.agents.length}</strong></article>
        <article><small>工作中 Agent</small><strong>{busyAgents}</strong></article>
      </div>

      <section className="content-block">
        <div className="section-heading">
          <span>会话列表</span>
          <small>{sorted.length}</small>
          <button className="button button--primary" onClick={onCreateToggle} type="button">
            {showCreate ? '收起' : '新建会话'}
          </button>
        </div>
        {showCreate ? (
          <CreateSessionForm runtime={runtime} onCancel={onCreateToggle} onCreated={onCreated} />
        ) : null}
        {!runtime.loaded ? (
          <SkeletonStack count={2} />
        ) : sorted.length === 0 ? (
          <EmptyState
            title="还没有会话"
            detail="新建一个会话，把 Claude 和 Codex 放进同一张工作台，它们就开始桥接协作。"
            action={onGoDeploy ? { label: '先登记 Agent', onClick: onGoDeploy } : undefined}
          />
        ) : (
          <div className="session-grid">
            {sorted.map((meeting) => (
              <SessionCard
                key={meeting.id}
                meeting={meeting}
                agentsById={agentsById}
                activeAgentIds={activeAgentIds}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

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

function AgentStateCard({
  agent,
  active,
  cliAvailable,
  taskCount,
  currentRun,
  onRemove,
}: {
  agent: MesaAgent;
  active: boolean;
  cliAvailable: boolean;
  taskCount: number;
  currentRun?: MesaAgentRun;
  onRemove?: (agentId: string) => void;
}) {
  return (
    <div className="agent-card">
      <AgentMark agent={agent} size="lg" />
      <div className="agent-card__body">
        <strong>{agent.name}</strong>
        <span className="agent-card__roles">{agent.roles.join(' · ')}</span>
        <AgentConnectionBadge active={active} cliAvailable={cliAvailable} />
        {currentRun ? (
          <span className="agent-card__run" title={`${currentRun.action} · ${currentRun.input}`}>
            {currentRun.action} · {currentRun.input}
          </span>
        ) : null}
      </div>
      <div className="agent-card__side">
        <span className="agent-card__tasks">{taskCount} 任务</span>
        {onRemove ? (
          <button className="agent-card__remove" onClick={() => onRemove(agent.id)} title="移出会话" aria-label={`移出 ${agent.name}`}>×</button>
        ) : null}
      </div>
    </div>
  );
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
      />
      <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
        <option value="">指派给…</option>
        {runtime.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <button type="submit" className="button button--primary" disabled={busy || !title.trim()}>
        {busy ? '创建中…' : '创建'}
      </button>
      <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>取消</button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}

function TimelineItem({
  message,
  agentsById,
}: {
  message: MesaMessage;
  agentsById: Map<string, MesaAgent>;
}) {
  const senderId = message.senderAgentId ?? message.from;
  const agent = agentsById.get(senderId);
  const label = agent ? agent.name : senderId === 'system' || senderId === 'user:desk' ? '系统' : senderId;
  return (
    <li className={`timeline-item ${agent ? '' : 'timeline-item--system'}`}>
      <span className="timeline-item__marker" aria-hidden="true" />
      <div className="timeline-item__body">
        <span className="timeline-item__head">
          <strong>{label}</strong>
          <small>{message.type.replace(/_/g, ' ')} · {formatTime(message.createdAt)}</small>
        </span>
        <p>{message.summary}</p>
      </div>
    </li>
  );
}

function SessionDetailView({
  runtime,
  config,
  setup,
  meetingId,
  onBack,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  config: RuntimeConfig;
  setup?: SetupStatus;
  meetingId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<MeetingDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string>();
  const [msgDraft, setMsgDraft] = useState('');
  const [sending, setSending] = useState(false);
  const timelineRef = useRef<HTMLOListElement>(null);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loadMeeting(config, meetingId)
      .then((next) => { if (active) setDetail(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, meetingId]);

  useEffect(() => reload(), [reload]);

  // Keep the newest message visible: scroll the timeline to the bottom when
  // this session's message count changes (SSE live-refresh or manual send).
  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollIntoView({ block: 'end' });
  }, [detail?.messages?.length]);

  // Live-refresh this session's timeline: re-fetch when a message lands for it.
  useEffect(() => {
    let active = true;
    let lastCursor: string | undefined;
    const stream = createEventStream(
      config,
      lastCursor,
      (envelope) => {
        lastCursor = envelope.cursor;
        const evt = envelope.event;
        const isThisMeeting = evt.meetingId === meetingId;
        const isTaskInMeeting = evt.streamType === 'task' &&
          (evt.data as { task?: { meetingId?: string } } | undefined)?.task?.meetingId === meetingId;
        if (isThisMeeting || isTaskInMeeting) {
          if (active) reload();
        }
      },
      () => undefined,
      () => undefined,
    );
    return () => { active = false; stream.close(); };
  }, [config, meetingId, reload]);

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
  const meeting = detail;
  const participants = (meeting?.agents ?? [])
    .map((id) => agentsById.get(id))
    .filter((agent): agent is MesaAgent => Boolean(agent));
  const uninvited = runtime.agents.filter((agent) => !(meeting?.agents ?? []).includes(agent.id));
  const sessionTasks = (meeting?.tasks ?? [])
    .map((id) => runtime.tasks.find((task) => task.id === id))
    .filter((task): task is MesaTask => Boolean(task));

  const invite = async (agentId: string) => {
    setInviteError(undefined);
    try {
      const updated = await runtime.inviteAgent(meetingId, agentId);
      setDetail((current) => (current ? { ...updated, messages: current.messages } : { ...updated, messages: [] }));
      setInviteOpen(false);
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeTaskStatus = async (taskId: string, status: string) => {
    setInviteError(undefined);
    try {
      await updateTaskStatus(config, taskId, status);
      await runtime.refresh();
      reload();
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeMeetingStatus = async (status: string) => {
    setInviteError(undefined);
    try {
      await updateMeetingStatus(config, meetingId, status);
      await runtime.refresh();
      reload();
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeAgent = async (agentId: string) => {
    setInviteError(undefined);
    try {
      const updated = await removeMeetingAgent(config, meetingId, agentId);
      setDetail((current) => (current ? { ...updated, messages: current.messages } : { ...updated, messages: [] }));
      await runtime.refresh();
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const sendMessage = async () => {
    const summary = msgDraft.trim();
    if (!summary) return;
    setSending(true);
    setInviteError(undefined);
    try {
      await postMeetingMessage(config, { meetingId, summary });
      setMsgDraft('');
      reload();
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="back-row">
          <button className="button button--ghost" onClick={onBack} type="button">← 返回会话列表</button>
        </div>
        <SkeletonStack count={2} />
      </>
    );
  }

  if (!meeting) {
    return (
      <>
        <div className="back-row">
          <button className="button button--ghost" onClick={onBack} type="button">← 返回会话列表</button>
        </div>
        <div className="error-state">
          <strong>无法加载会话</strong>
          <p>{error ?? '会话不存在或已被移除。'}</p>
        </div>
      </>
    );
  }

  const pair = participants.slice(0, 2);

  return (
    <>
      <div className="back-row">
        <button className="button button--ghost" onClick={onBack} type="button">← 返回会话列表</button>
        <span className="session-detail__id">{meeting.id}</span>
      </div>

      <header className="session-detail">
        <div className="session-detail__title">
          <h2>{meeting.title}</h2>
          <span className={`status ${statusClass(meeting.status)}`}>{meeting.status}</span>
          <div className="session-detail__actions">
            {meeting.status !== 'archived' && meeting.status !== 'completed' && meeting.status !== 'closed' ? (
              <>
                <button className="button button--sm button--ghost" onClick={() => void changeMeetingStatus('completed')}>结束</button>
                <button className="button button--sm button--ghost" onClick={() => void changeMeetingStatus('archived')}>归档</button>
              </>
            ) : null}
          </div>
        </div>
        {meeting.purpose ? <p className="session-detail__purpose">{meeting.purpose}</p> : null}
        {pair.length >= 2 ? (
          <p className="session-detail__bridge">
            <span className="session-detail__link" aria-hidden="true" />
            {pair.map((agent) => agent.name).join(' ↔ ')} 已在同一会话协作
          </p>
        ) : participants.length === 1 ? (
          <p className="session-detail__bridge session-detail__bridge--waiting">
            <span className="session-detail__link session-detail__link--solo" aria-hidden="true" />
            {participants[0]!.name} 已加入，再邀请一个 Agent 完成桥接
          </p>
        ) : null}
      </header>

      <section className="content-block">
        <div className="section-heading">
          <span>参与的 Agent</span>
          <small>{participants.length} / {runtime.agents.length}</small>
          {uninvited.length > 0 ? (
            <button className="button button--ghost button--sm" onClick={() => setInviteOpen((value) => !value)} type="button">
              {inviteOpen ? '收起' : '邀请加入'}
            </button>
          ) : null}
        </div>
        {participants.length === 0 ? (
          <EmptyState title="会话还没有 Agent" detail="把两个 Agent 邀请进同一会话，它们就开始桥接协作。" />
        ) : (
          <div className="agent-grid">
            {participants.map((agent) => (
              <AgentStateCard
                key={agent.id}
                agent={agent}
                active={activeAgentIds.has(agent.id)}
                cliAvailable={cliAvailableFor(setup, agent.id)}
                taskCount={sessionTasks.filter((task) => task.assignedTo === agent.id).length}
                currentRun={runByAgent.get(agent.id)}
                onRemove={removeAgent}
              />
            ))}
          </div>
        )}
        {inviteOpen && uninvited.length > 0 ? (
          <div className="invite-row">
            <span>把 Agent 加入这个会话：</span>
            <div className="agent-pick-row">
              {uninvited.map((agent) => (
                <button key={agent.id} className="agent-pick" onClick={() => void invite(agent.id)} type="button">
                  <AgentMark agent={agent} size="sm" />
                  <span>{agent.name}</span>
                  <span className="agent-pick__add">加入</span>
                </button>
              ))}
            </div>
            {inviteError ? <p className="inline-error">{inviteError}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="content-block">
        <div className="section-heading">
          <span>任务</span>
          <small>{sessionTasks.length}</small>
          <button className="button button--ghost button--sm" onClick={() => setTaskFormOpen((value) => !value)} type="button">
            {taskFormOpen ? '收起' : '新建任务'}
          </button>
        </div>
        {taskFormOpen ? (
          <TaskForm
            runtime={runtime}
            meetingId={meeting.id}
            onCancel={() => setTaskFormOpen(false)}
            onCreated={() => { setTaskFormOpen(false); reload(); }}
          />
        ) : null}
        {sessionTasks.length === 0 ? (
          <EmptyState title="暂无任务" detail="新建一个任务并指派 Agent，让会话真正开工。" />
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

      <section className="content-block">
        <div className="section-heading">
          <span>消息时间线</span>
          <small>{meeting.messages?.length ?? 0}</small>
        </div>
        {!meeting.messages || meeting.messages.length === 0 ? (
          <EmptyState title="还没有消息" detail="任务创建、Agent 交接和评审都会出现在这里。" />
        ) : (
          <ol className="timeline" ref={timelineRef}>
            {[...meeting.messages]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((message) => (
                <TimelineItem key={message.id} message={message} agentsById={agentsById} />
              ))}
          </ol>
        )}
        <div className="session-send">
          <input
            value={msgDraft}
            onChange={(event) => setMsgDraft(event.target.value)}
            placeholder="给会话发一条消息，所有参与的 Agent 都会看到…"
            spellCheck={false}
            onKeyDown={(event) => { if (event.key === 'Enter') void sendMessage(); }}
          />
          <button className="button button--primary" onClick={() => void sendMessage()} disabled={!msgDraft.trim() || sending}>
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
        {inviteError ? <p className="inline-error">{inviteError}</p> : null}
      </section>
    </>
  );
}

function SessionsView({
  config,
  runtime,
  selectedId,
  onSelect,
  onBack,
  onGoDeploy,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onGoDeploy?: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [setup, setSetup] = useState<SetupStatus>();

  useEffect(() => {
    loadSetupStatus(config).then(setSetup).catch(() => undefined);
  }, [config]);

  if (selectedId) {
    return (
      <SessionDetailView
        runtime={runtime}
        config={config}
        setup={setup}
        meetingId={selectedId}
        onBack={onBack}
      />
    );
  }

  return (
    <SessionListView
      runtime={runtime}
      showCreate={showCreate}
      onCreateToggle={() => setShowCreate((value) => !value)}
      onSelect={onSelect}
      onCreated={(id) => { setShowCreate(false); onSelect(id); }}
      onGoDeploy={onGoDeploy}
    />
  );
}

// ---------------------------------------------------------------------------
// Rooms — cross-workspace group chat (拉群).
// ---------------------------------------------------------------------------

function RoomMessageItem({ message }: { message: RoomMessage }) {
  const label = message.from.label ?? message.from.ref;
  return (
    <li className={`room-msg ${message.from.kind === 'agent' ? 'room-msg--agent' : ''}`}>
      <span className="room-msg__marker" aria-hidden="true" />
      <div className="room-msg__body">
        <span className="room-msg__head">
          <strong>{label}</strong>
          <small>{message.type.replace(/_/g, ' ')} · {formatTime(message.createdAt)}</small>
        </span>
        <p>{message.summary}</p>
      </div>
    </li>
  );
}

function RoomsView({
  config,
  roomId,
  onRoomChange,
}: {
  config: RuntimeConfig;
  roomId?: string;
  onRoomChange: (id: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selected, setSelected] = useState<RoomDetail>();
  const [workspaces, setWorkspaces] = useState<WorkspaceList['workspaces']>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [pickWs, setPickWs] = useState<string>('');
  const [pickKind, setPickKind] = useState<'session' | 'agent'>('session');
  const [pickItems, setPickItems] = useState<Array<{ ref: string; label: string }>>([]);
  const [newName, setNewName] = useState('');
  const [newPurpose, setNewPurpose] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  const [streamConnected, setStreamConnected] = useState(false);
  // Read baseline per room: the last messageId the user has effectively seen.
  // Set on first load so pre-existing messages are not counted as unread.
  const lastSeenRef = useRef<Record<string, string | undefined>>({});
  const msgListRef = useRef<HTMLOListElement>(null);

  const refreshRooms = useCallback(() => {
    loadRooms(config)
      .then((list) => {
        setRooms(list);
        for (const room of list) {
          if (lastSeenRef.current[room.id] === undefined && room.lastMessageId) {
            lastSeenRef.current[room.id] = room.lastMessageId;
          }
        }
      })
      .catch(() => undefined);
  }, [config]);

  const refreshSelected = useCallback(() => {
    if (!selected) return;
    loadRoom(config, selected.id).then(setSelected).catch(() => undefined);
  }, [config, selected?.id]);

  useEffect(() => refreshRooms(), [refreshRooms]);
  useEffect(() => {
    loadWorkspaces(config)
      .then((state) => {
        setWorkspaces(state.workspaces);
        setActiveWorkspaceId(state.activeWorkspaceId ?? '');
      })
      .catch(() => undefined);
  }, [config]);

  // Live room-message stream: a new message in another room bumps its unread
  // count; a message in the open room just refreshes the timeline.
  useEffect(() => {
    const stream = createRoomEventStream(
      config,
      (event) => {
        if (event.roomId === roomId) {
          setUnreadByRoom((prev) => ({ ...prev, [event.roomId]: 0 }));
          refreshSelected();
        } else {
          setUnreadByRoom((prev) => ({ ...prev, [event.roomId]: (prev[event.roomId] ?? 0) + 1 }));
        }
        refreshRooms();
      },
      () => setStreamConnected(true),
      () => setStreamConnected(false),
    );
    return () => stream.close();
  }, [config, roomId, refreshRooms, refreshSelected]);

  // Low-frequency poll as a fallback when the room watcher is unavailable (the
  // stream itself carries the real-time path; this only covers silent drops).
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => refreshSelected(), 30_000);
    return () => clearInterval(timer);
  }, [config, selected?.id, refreshSelected]);

  // Opening a room marks it read.
  useEffect(() => {
    if (!roomId) return;
    setUnreadByRoom((prev) => ({ ...prev, [roomId]: 0 }));
    const room = rooms.find((entry) => entry.id === roomId);
    if (room?.lastMessageId) lastSeenRef.current[roomId] = room.lastMessageId;
  }, [roomId, rooms]);

  // Auto-scroll the timeline to the bottom when the room or its message count
  // changes, so new messages are always visible without manual scrolling.
  useEffect(() => {
    const el = msgListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selected?.id, selected?.messages.length]);

  const wsNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  // The selected room is driven by the parent's `roomId` (from the URL hash).
  // When it changes, load the room detail; deeper refreshes use refreshSelected.
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    loadRoom(config, roomId)
      .then((detail) => { if (active) setSelected(detail); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [config, roomId]);

  const removeMember = async (member: RoomMember) => {
    if (!selected) return;
    try {
      await leaveRoomMember(config, selected.id, {
        workspaceId: member.workspaceId,
        kind: member.kind,
        ref: member.ref,
      });
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const makeRoom = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const room = await createRoom(config, {
        name,
        ...(newPurpose.trim() ? { purpose: newPurpose.trim() } : {}),
      });
      setNewName('');
      setNewPurpose('');
      await refreshRooms();
      onRoomChange(room.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  // Load the sessions/agents available in the picked workspace for the invite panel.
  const loadPickItems = async (workspaceId: string) => {
    setPickWs(workspaceId);
    setError(undefined);
    try {
      if (pickKind === 'session') {
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
    if (pickWs) await loadPickItems(pickWs);
  };

  const invite = async (member: { workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string; label?: string }) => {
    if (!selected) return;
    try {
      await inviteRoomMember(config, selected.id, member);
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  // The human operator speaks as themselves, never as a picked session/agent.
  // Sending with a spoofed identity was the P0 defect; the sender is always the
  // current user, auto-joined into the room if not already a member.
  const send = async () => {
    const summary = draft.trim();
    if (!summary || !selected) return;
    try {
      const humanWs = pickWs || (activeWorkspaceId ?? '');
      const humanMember = { workspaceId: humanWs, kind: 'human' as const, ref: 'user', label: '我' };
      // Ensure the human is a member (auto-join) so the server accepts the post.
      if (!selected.members.some(
        (member) => member.kind === 'human' && member.ref === 'user',
      )) {
        await inviteRoomMember(config, selected.id, humanMember);
      }
      await sendRoomMessage(config, selected.id, {
        workspaceId: humanWs,
        from: humanMember,
        summary,
      });
      setDraft('');
      await refreshSelected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="rooms-view">
      {/* Left: room list + create */}
      <aside className="rooms-col">
        <div className="section-heading"><span>群聊</span><small>{rooms.length}</small></div>
        <div className="room-create">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="新群聊名称…"
            spellCheck={false}
          />
          <input
            value={newPurpose}
            onChange={(event) => setNewPurpose(event.target.value)}
            placeholder="主题/目的（可选），例如：评审 7 月版登录重构"
            spellCheck={false}
          />
          <button className="button button--sm button--primary" onClick={() => void makeRoom()} disabled={!newName.trim()}>
            建群
          </button>
        </div>
        {rooms.length === 0 ? (
          <EmptyState title="还没有群聊" detail="建一个群，把不同项目的会话和 Agent 拉进来。" />
        ) : (
          <div className="room-list">
            {rooms.map((room) => {
              const unread = unreadByRoom[room.id] ?? 0;
              return (
                <button
                  key={room.id}
                  className={`room-row ${selected?.id === room.id ? 'room-row--active' : ''}`}
                  onClick={() => onRoomChange(room.id)}
                >
                  <span className="room-row__name">
                    <strong>{room.name}</strong>
                    {unread > 0 ? <span className="room-row__unread">{unread}</span> : null}
                  </span>
                  <small className="room-row__meta">
                    {room.lastMessagePreview ? (
                      <span className="room-row__preview">{room.lastMessagePreview}</span>
                    ) : null}
                    <span>{room.members.length} 成员</span>
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Middle: message timeline */}
      <section className="rooms-col rooms-col--stream">
        {!selected ? (
          <EmptyState title="选择一个群聊" detail="左侧选择或新建群聊，查看跨项目消息。" />
        ) : (
          <>
            <header className="rooms-stream__head">
              <h3>{selected.name}</h3>
              <span className="rooms-stream__meta">
                <small>{selected.members.length} 成员</small>
                <span className={`room-live ${streamConnected ? 'room-live--on' : ''}`} title={streamConnected ? '实时推送已连接' : '实时推送未连接（低频轮询兜底）'}>
                  <span className="room-live__dot" />{streamConnected ? '实时' : '轮询'}
                </span>
              </span>
            </header>
            {selected.purpose ? <p className="rooms-stream__purpose">{selected.purpose}</p> : null}
            {selected.members.length > 0 ? (
              <div className="room-members">
                <span className="room-members__label">成员</span>
                <div className="room-members__list">
                  {selected.members.map((member) => (
                    <span
                      key={`${member.workspaceId}:${member.kind}:${member.ref}`}
                      className="room-member"
                      title={`${member.label ?? member.ref} · ${wsNameById.get(member.workspaceId) ?? member.workspaceId}`}
                    >
                      <span className={`room-member__kind room-member__kind--${member.kind}`}>
                        {memberKindLabels[member.kind]}
                      </span>
                      <strong>{member.label ?? member.ref}</strong>
                      <small>{wsNameById.get(member.workspaceId) ?? member.workspaceId}</small>
                      <button
                        type="button"
                        className="room-member__remove"
                        title={`把 ${member.label ?? member.ref} 移出群聊`}
                        aria-label={`把 ${member.label ?? member.ref} 移出群聊`}
                        onClick={() => void removeMember(member)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {typeof selected.totalMessages === 'number' && selected.totalMessages > selected.messages.length ? (
              <p className="room-history-hint">只显示最近 {selected.messages.length} 条（共 {selected.totalMessages} 条）</p>
            ) : null}
            <ol className="room-msg-list" ref={msgListRef}>
              {selected.messages.length === 0 ? (
                <EmptyState title="还没有消息" detail="把不同项目的会话/Agent 拉进群，开始跨项目协作。" />
              ) : (
                selected.messages.map((message) => <RoomMessageItem key={message.id} message={message} />)
              )}
            </ol>
            <div className="room-send">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="发消息到群聊…"
                spellCheck={false}
                onKeyDown={(event) => { if (event.key === 'Enter') void send(); }}
              />
              <button className="button button--primary" onClick={() => void send()} disabled={!draft.trim()}>发送</button>
            </div>
          </>
        )}
      </section>

      {/* Right: invite panel (拉群) */}
      <aside className="rooms-col rooms-col--invite">
        <div className="section-heading"><span>拉群</span></div>
        {!selected ? (
          <p className="rooms-invite__hint">先选一个群聊。</p>
        ) : (
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
            {error ? <p className="inline-error">{error}</p> : null}
          </div>
        )}
      </aside>
    </div>
  );
}

function RunDetailView({
  run,
  config,
  onClose,
  onCancelled,
}: {
  run: MesaAgentRun;
  config: RuntimeConfig;
  onClose: () => void;
  onCancelled?: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const cancellable = run.status === 'pending' || run.status === 'running';

  const cancel = async () => {
    setCancelling(true);
    setError(undefined);
    try {
      await updateRunStatus(config, run.id, { status: 'cancelled' });
      onCancelled?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="entity-detail">
      <header className="entity-detail__head">
        <div>
          <h4>{run.agentId}</h4>
          <span className={`status status--${run.status}`}>{run.status}</span>
        </div>
        <div className="entity-detail__head-actions">
          {cancellable ? (
            <button className="button button--sm button--danger" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? '取消中…' : '取消运行'}
            </button>
          ) : null}
          <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
      </header>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="entity-detail__row"><span>动作</span><strong>{run.action}</strong></div>
      <div className="entity-detail__row"><span>输入</span><p>{run.input}</p></div>
      <div className="entity-detail__row"><span>输出</span><p>{run.outputSummary || run.output || '（无输出）'}</p></div>
      {run.error ? <div className="entity-detail__row"><span>错误</span><p className="entity-detail__error">{run.error}</p></div> : null}
      <div className="entity-detail__row"><span>开始于</span><strong>{new Date(run.startedAt).toLocaleString()}</strong></div>
    </div>
  );
}

function WorkflowDetailView({ workflow, onClose }: { workflow: WorkflowState; onClose: () => void }) {
  const steps = (workflow as unknown as { history?: Array<{ stepId: string; status: string }> }).history ?? [];
  return (
    <div className="entity-detail">
      <header className="entity-detail__head">
        <div>
          <h4>工作流 {workflow.workflowId}</h4>
          <span className={`status status--${workflow.status}`}>{workflow.status}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="entity-detail__row"><span>任务</span><strong>{workflow.taskId}</strong></div>
      <div className="entity-detail__row"><span>当前步骤</span><strong>{workflow.currentStep}</strong></div>
      {steps.length > 0 ? (
        <div className="entity-detail__row">
          <span>步骤历史</span>
          <ol className="entity-detail__steps">
            {steps.map((step, index) => (
              <li key={index}>
                <span className={`status status--${step.status}`}>{step.status}</span>
                {step.stepId}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceSwitcher({ config }: { config: RuntimeConfig }) {
  const [state, setState] = useState<WorkspaceList>();
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newRoot, setNewRoot] = useState('');
  const [newName, setNewName] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    loadWorkspaces(config).then(setState).catch(() => undefined);
  }, [config]);

  useEffect(() => refresh(), [refresh]);

  const activeName = state?.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.name;

  const remove = async (workspaceId: string) => {
    const workspace = state?.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace || busy) return;
    // The active workspace is where the desk is currently running; removing it
    // would orphan the live view. Guarded in the UI as well as the backend.
    if (workspaceId === state?.activeWorkspaceId) return;
    if (!window.confirm(`从工作区列表移除「${workspace.name}」？\n（不会删除项目目录，仅解除注册）`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await removeWorkspace(config, workspaceId);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (workspaceId: string) => {
    if (busy || workspaceId === state?.activeWorkspaceId) return;
    setBusy(true);
    setError(undefined);
    try {
      // The desktop main process restarts the desk for the new root and reloads
      // this window with the new base URL — the renderer must NOT self-reload
      // (that would race the main process's reload and reconnect to a stale
      // base URL). Fire-and-forget the activation; the reload lands on top.
      await activateWorkspace(config, workspaceId).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    const rootDir = newRoot.trim();
    if (!rootDir || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await registerWorkspace(config, { rootDir, ...(newName.trim() ? { name: newName.trim() } : {}) });
      setNewRoot('');
      setNewName('');
      setRegisterOpen(false);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-switcher no-drag">
      <select
        className="workspace-switcher__select"
        value={state?.activeWorkspaceId ?? ''}
        onChange={(event) => {
          if (event.target.value === '__register__') {
            setRegisterOpen(true);
            setError(undefined);
            return;
          }
          if (event.target.value) void switchTo(event.target.value);
        }}
        disabled={busy}
        aria-label="切换工作区"
        title="切换工作区"
      >
        <option value="" disabled>{activeName ?? '工作区'}</option>
        {state?.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
        <option value="__register__">＋ 注册工作区…</option>
      </select>
      {registerOpen ? (
        <div className="workspace-register">
          <input
            value={newRoot}
            onChange={(event) => setNewRoot(event.target.value)}
            placeholder="项目目录，例如 D:\git\Idel-Game"
            spellCheck={false}
          />
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="显示名（可选）"
            spellCheck={false}
          />
          {error ? <p className="inline-error">{error}</p> : null}
          <div className="workspace-register__actions">
            <button className="button button--sm button--ghost" onClick={() => { setRegisterOpen(false); setError(undefined); }}>取消</button>
            <button className="button button--sm button--primary" onClick={() => void register()} disabled={busy || !newRoot.trim()}>
              注册
            </button>
          </div>
        </div>
      ) : (
        <div className="workspace-switcher__adds">
          <button className="workspace-switcher__add" onClick={() => { setRegisterOpen(true); setError(undefined); }} title="注册工作区" aria-label="注册工作区">＋</button>
          <button
            className="workspace-switcher__manage"
            onClick={() => setManageOpen((value) => !value)}
            title="管理工作区"
            aria-label="管理工作区"
          >⚙</button>
        </div>
      )}
      {manageOpen ? (
        <div className="workspace-manage">
          <strong className="workspace-manage__title">工作区</strong>
          {state?.workspaces.length === 0 ? (
            <p className="workspace-manage__empty">还没有注册工作区。</p>
          ) : (
            <ul className="workspace-manage__list">
              {state?.workspaces.map((workspace) => (
                <li key={workspace.id} className="workspace-manage__row">
                  <span
                    className={`workspace-manage__name ${workspace.id === state.activeWorkspaceId ? 'workspace-manage__name--active' : ''}`}
                    title={workspace.rootDir}
                  >
                    {workspace.name}
                    {workspace.id === state.activeWorkspaceId ? ' · 当前' : ''}
                  </span>
                  <button
                    className="workspace-manage__remove"
                    disabled={workspace.id === state.activeWorkspaceId || busy}
                    title={workspace.id === state.activeWorkspaceId ? '当前工作区不可移除' : '从列表移除（不删目录）'}
                    aria-label={`移除 ${workspace.name}`}
                    onClick={() => void remove(workspace.id)}
                  >×</button>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type Section = 'overview' | 'runs' | 'workflows' | 'sessions' | 'rooms' | 'deploy';

interface HashRoute {
  section: Section;
  sessionId?: string;
  roomId?: string;
}

function parseHashRoute(): HashRoute {
  const h = window.location.hash;
  if (h.startsWith('#/sessions/')) {
    return { section: 'sessions', sessionId: h.slice('#/sessions/'.length).split('/')[0] };
  }
  if (h.startsWith('#/rooms/')) {
    return { section: 'rooms', roomId: h.slice('#/rooms/'.length).split('/')[0] };
  }
  if (h.startsWith('#/sessions')) return { section: 'sessions' };
  if (h.startsWith('#/rooms')) return { section: 'rooms' };
  if (h.startsWith('#/runs')) return { section: 'runs' };
  if (h.startsWith('#/workflows')) return { section: 'workflows' };
  if (h.startsWith('#/deploy')) return { section: 'deploy' };
  if (h.startsWith('#/overview')) return { section: 'overview' };
  return { section: 'overview' };
}

function MainView({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const initialRoute = parseHashRoute();
  const [section, setSection] = useState<Section>(initialRoute.section);
  const [sessionId, setSessionId] = useState<string | undefined>(initialRoute.sessionId);
  const [roomId, setRoomId] = useState<string | undefined>(initialRoute.roomId);
  const [selectedRun, setSelectedRun] = useState<MesaAgentRun>();
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowState>();

  // Hash is the single source of truth for section + session/room detail. Any
  // navigation writes a hash; `hashchange` applies it back to state so the
  // browser back/forward buttons and deep links work.
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
  const recentRuns = useMemo(
    () => [...runtime.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 8),
    [runtime.runs],
  );
  const [eventFilter, setEventFilter] = useState<EventCategory>('all');
  const visibleEvents = useMemo(
    () => runtime.events.filter(({ event }) => eventFilter === 'all' || eventCategory(event.type) === eventFilter),
    [runtime.events, eventFilter],
  );

  // Open the run / workflow / session a live event belongs to. Run and workflow
  // use the in-page detail drawers; meeting/task/message events deep-link to the
  // session page.
  const handleEventNavigate = useCallback((envelope: EventEnvelope) => {
    const event = envelope.event;
    const data = event.data as Record<string, unknown>;
    const type = event.type;
    if (type.startsWith('agent_run_')) {
      const runId = (data.run as { id?: string } | undefined)?.id ?? (data.runId as string | undefined) ?? event.streamId;
      const run = runtime.runs.find((entry) => entry.id === runId);
      if (run) {
        go('#/runs', { section: 'runs' });
        setSelectedRun(run);
      }
      return;
    }
    if (type.startsWith('workflow_')) {
      const workflowId = (data.workflowId as string | undefined) ?? event.streamId;
      const workflow = runtime.workflows.find((entry) => entry.workflowId === workflowId);
      if (workflow) {
        go('#/workflows', { section: 'workflows' });
        setSelectedWorkflow(workflow);
      }
      return;
    }
    const meetingId = event.meetingId ?? (data.meeting as { id?: string } | undefined)?.id
      ?? (data.task as { meetingId?: string } | undefined)?.meetingId;
    if (meetingId) {
      go(`#/sessions/${meetingId}`, { section: 'sessions', sessionId: meetingId });
    }
  }, [runtime.runs, runtime.workflows, go]);

  return (
    <main className="app-shell">
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

      <aside className="rail no-drag">
        <button className="rail__logo" onClick={() => go('#/overview', { section: 'overview' })}>M</button>
        <nav>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => go('#/overview', { section: 'overview' })} title="概览" aria-label="概览"><RailIcon kind="overview" /></button>
          <button className={section === 'runs' ? 'active' : ''} onClick={() => go('#/runs', { section: 'runs' })} title="运行" aria-label="运行"><RailIcon kind="runs" /></button>
          <button className={section === 'workflows' ? 'active' : ''} onClick={() => go('#/workflows', { section: 'workflows' })} title="工作流" aria-label="工作流"><RailIcon kind="workflows" /></button>
          <button className={section === 'sessions' ? 'active' : ''} onClick={() => go('#/sessions', { section: 'sessions' })} title="会话" aria-label="会话"><RailIcon kind="sessions" /></button>
          <button className={section === 'rooms' ? 'active' : ''} onClick={() => go('#/rooms', { section: 'rooms' })} title="群聊" aria-label="群聊"><RailIcon kind="rooms" /></button>
          <button className={section === 'deploy' ? 'active' : ''} onClick={() => go('#/deploy', { section: 'deploy' })} title="部署" aria-label="部署"><RailIcon kind="deploy" /></button>
        </nav>
        <span className="rail__avatar">AM</span>
      </aside>

      <section className="workspace">
        <header className="workspace__header">
          <div>
            <span className="eyebrow">实时控制中心</span>
            <h1>{section === 'overview' ? '概览' : section === 'runs' ? 'Agent 运行' : section === 'workflows' ? '工作流' : section === 'sessions' ? '会话' : section === 'rooms' ? '群聊' : '部署'}</h1>
          </div>
          <button className="button button--ghost" onClick={() => runtime.refresh()}>刷新</button>
        </header>

        {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}

        {section !== 'deploy' && section !== 'sessions' && section !== 'rooms' ? (
          <div className="metric-grid">
            <article><small>运行中的 Agent</small><strong>{runtime.activeRuns.length}</strong></article>
            <article><small>待审批</small><strong>{runtime.waiting.length}</strong></article>
            <article><small>失败的运行</small><strong>{runtime.failedRuns.length}</strong></article>
          </div>
        ) : null}

        {section === 'deploy' ? (
          <DeployView config={config} />
        ) : section === 'sessions' ? (
          <SessionsView
            config={config}
            runtime={runtime}
            selectedId={sessionId}
            onSelect={(id) => go(`#/sessions/${id}`, { section: 'sessions', sessionId: id })}
            onBack={() => go('#/sessions', { section: 'sessions' })}
            onGoDeploy={() => go('#/deploy', { section: 'deploy' })}
          />
        ) : section === 'rooms' ? (
          <RoomsView config={config} roomId={roomId} onRoomChange={(id) => go(`#/rooms/${id}`, { section: 'rooms', roomId: id })} />
        ) : (
          <>
            {runtime.waiting.length > 0 && section === 'overview' ? (
              <section className="content-block">
                <div className="section-heading"><span>决策队列</span><small>{runtime.waiting.length}</small></div>
                <div className="approval-grid">
                  {runtime.waiting.map((workflow) => (
                    <ApprovalCard
                      key={workflow.workflowId}
                      workflow={workflow}
                      task={runtime.tasks.find((task) => task.id === workflow.taskId)}
                      onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {section === 'overview' || section === 'runs' ? (
              <section className="content-block">
                <div className="section-heading"><span>最近的运行</span><small>{runtime.runs.length}</small></div>
                {!runtime.loaded ? (
                  <SkeletonStack count={2} />
                ) : recentRuns.length > 0 ? (
                  <>
                    <div className="run-grid">{recentRuns.map((run) => <RunCard key={run.id} run={run} onSelect={setSelectedRun} />)}</div>
                    {selectedRun ? (
                      <RunDetailView
                        run={selectedRun}
                        config={config}
                        onClose={() => setSelectedRun(undefined)}
                        onCancelled={() => { void runtime.refresh(); setSelectedRun(undefined); }}
                      />
                    ) : null}
                  </>
                ) : (
                  <EmptyState title="暂无运行" detail="工作流启动后，Agent 运行会立即显示。" />
                )}
              </section>
            ) : (
              <section className="content-block">
                <div className="section-heading"><span>工作流状态</span><small>{runtime.workflows.length}</small></div>
                {!runtime.loaded ? (
                  <SkeletonStack count={2} />
                ) : (
                  <div className="workflow-list">
                    {runtime.workflows.map((workflow) => (
                      <button key={workflow.workflowId} onClick={() => setSelectedWorkflow(workflow)}>
                        <span><strong>{workflow.taskId}</strong><small>{workflow.currentStep}</small></span>
                        <span className={`status status--${workflow.status}`}>{workflow.status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedWorkflow ? (
                  <WorkflowDetailView workflow={selectedWorkflow} onClose={() => setSelectedWorkflow(undefined)} />
                ) : null}
              </section>
            )}
          </>
        )}
      </section>

      <aside className="activity-panel">
        <div className="section-heading"><span>实时活动</span><small>{runtime.events.length}</small></div>
        <div className="event-filters">
          {(Object.keys(EVENT_CATEGORY_LABELS) as EventCategory[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`event-filter ${eventFilter === key ? 'event-filter--active' : ''}`}
              onClick={() => setEventFilter(key)}
            >
              {EVENT_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>
        {!runtime.loaded ? (
          <SkeletonStack count={3} compact />
        ) : visibleEvents.length > 0 ? (
          <ol className="event-list">{[...visibleEvents].reverse().map((event) => <EventRow key={event.cursor} envelope={event} onNavigate={handleEventNavigate} />)}</ol>
        ) : (
          <EmptyState title="没有这类事件" detail="时间线无需轮询，自动更新。" />
        )}
      </aside>

      <footer className="statusbar">
        <ConnectionBadge state={runtime.connection} />
        <span>{runtime.runs.length} 个运行 · {runtime.workflows.length} 个工作流</span>
        <span>AgentMesa 桌面版</span>
      </footer>
    </main>
  );
}

export function App() {
  const config = useMemo(readConfig, []);
  return config.view === 'widget' ? <WidgetView config={config} /> : <MainView config={config} />;
}
