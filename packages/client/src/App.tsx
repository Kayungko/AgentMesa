import { useMemo, useState } from 'react';
import type { EventEnvelope, MesaAgentRun } from '@agentmesa/protocol';
import { useMesaRuntime, type ConnectionState } from './useMesaRuntime.js';
import type { RuntimeConfig, WorkflowState } from './types.js';
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

function ProgressBar({ run }: { run: MesaAgentRun }) {
  const percent = run.status === 'completed' ? 100 : run.status === 'running' ? 56 : 12;
  return (
    <div className="progress" aria-label={`${percent}%`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function RunCard({ run, compact = false }: { run: MesaAgentRun; compact?: boolean }) {
  return (
    <button
      className={`run-card ${compact ? 'run-card--compact' : ''}`}
      onClick={() => window.agentmesa?.openMain(`/runs/${run.id}`)}
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
  onDecide,
}: {
  workflow: WorkflowState;
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
          <small>需要你的决策</small>
          <strong>{workflow.taskId}</strong>
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

function EmptyState({ title, detail }: { title: string; detail: string }) {
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

function RailIcon({ kind }: { kind: 'overview' | 'runs' | 'workflows' }) {
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

function EventRow({ envelope }: { envelope: EventEnvelope }) {
  const title = envelope.event.type.replaceAll('_', ' ');
  return (
    <li className="event-row">
      <span className={`event-row__marker event-row__marker--${envelope.event.streamType}`} />
      <div>
        <strong>{title}</strong>
        <small>{envelope.event.actor} · {new Date(envelope.event.timestamp).toLocaleTimeString()}</small>
      </div>
    </li>
  );
}

function MainView({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const initialSection = window.location.hash.startsWith('#/runs/')
    ? 'runs'
    : window.location.hash.startsWith('#/workflows/')
      ? 'workflows'
      : 'overview';
  const [section, setSection] = useState<'overview' | 'runs' | 'workflows'>(initialSection);
  const recentRuns = useMemo(
    () => [...runtime.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 8),
    [runtime.runs],
  );

  return (
    <main className="app-shell">
      <header className="titlebar draggable">
        <div className="titlebar__brand">
          <span className="brand-mark">M</span>
          <span>AgentMesa</span>
        </div>
        <span className="titlebar__workspace">实时 Agent 工作区</span>
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
        <button className="rail__logo" onClick={() => setSection('overview')}>M</button>
        <nav>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')} title="概览" aria-label="概览"><RailIcon kind="overview" /></button>
          <button className={section === 'runs' ? 'active' : ''} onClick={() => setSection('runs')} title="运行" aria-label="运行"><RailIcon kind="runs" /></button>
          <button className={section === 'workflows' ? 'active' : ''} onClick={() => setSection('workflows')} title="工作流" aria-label="工作流"><RailIcon kind="workflows" /></button>
        </nav>
        <span className="rail__avatar">AM</span>
      </aside>

      <section className="workspace">
        <header className="workspace__header">
          <div>
            <span className="eyebrow">实时控制中心</span>
            <h1>{section === 'overview' ? '概览' : section === 'runs' ? 'Agent 运行' : '工作流'}</h1>
          </div>
          <button className="button button--ghost" onClick={() => runtime.refresh()}>刷新</button>
        </header>

        {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}

        <div className="metric-grid">
          <article><small>运行中的 Agent</small><strong>{runtime.activeRuns.length}</strong></article>
          <article><small>待审批</small><strong>{runtime.waiting.length}</strong></article>
          <article><small>失败的运行</small><strong>{runtime.failedRuns.length}</strong></article>
        </div>

        {runtime.waiting.length > 0 && section !== 'runs' ? (
          <section className="content-block">
            <div className="section-heading"><span>决策队列</span><small>{runtime.waiting.length}</small></div>
            <div className="approval-grid">
              {runtime.waiting.map((workflow) => (
                <ApprovalCard
                  key={workflow.workflowId}
                  workflow={workflow}
                  onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {section !== 'workflows' ? (
          <section className="content-block">
            <div className="section-heading"><span>最近的运行</span><small>{runtime.runs.length}</small></div>
            {!runtime.loaded ? (
              <SkeletonStack count={2} />
            ) : recentRuns.length > 0 ? (
              <div className="run-grid">{recentRuns.map((run) => <RunCard key={run.id} run={run} />)}</div>
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
                  <button key={workflow.workflowId} onClick={() => window.agentmesa?.openMain(`/workflows/${workflow.workflowId}`)}>
                    <span><strong>{workflow.taskId}</strong><small>{workflow.currentStep}</small></span>
                    <span className={`status status--${workflow.status}`}>{workflow.status}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </section>

      <aside className="activity-panel">
        <div className="section-heading"><span>实时活动</span><small>{runtime.events.length}</small></div>
        {!runtime.loaded ? (
          <SkeletonStack count={3} compact />
        ) : runtime.events.length > 0 ? (
          <ol className="event-list">{[...runtime.events].reverse().map((event) => <EventRow key={event.cursor} envelope={event} />)}</ol>
        ) : (
          <EmptyState title="等待事件" detail="时间线无需轮询，自动更新。" />
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
