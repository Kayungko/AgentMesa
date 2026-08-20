import { useState } from 'react';
import { useMesaRuntime } from '../../useMesaRuntime.js';
import type { RuntimeConfig } from '../../types.js';
import { ConnectionBadge, connectionLabels } from '../ui/badge.js';
import { EmptyState } from '../ui/empty.js';
import { IconButton } from '../ui/icon-button.js';
import { SkeletonStack } from '../ui/skeleton.js';
import { useFreshMembers } from '../ui/use-fresh-members.js';
import { X } from '../ui/icons.js';
import { ApprovalCard } from '../cards/approval-card.js';
import { RunCard } from '../cards/run-card.js';

export function WidgetView({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const [expanded, setExpanded] = useState(false);
  const focusRun = runtime.activeRuns[0];
  const freshApprovalIds = useFreshMembers('widget-approvals', runtime.waiting.map((workflow) => workflow.workflowId));

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
          <IconButton label="收起" onClick={toggle}>−</IconButton>
          <IconButton label="隐藏" onClick={() => window.agentmesa?.hideWidget()}><X size={15} /></IconButton>
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
                fresh={freshApprovalIds.has(workflow.workflowId)}
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
