// ---------------------------------------------------------------------------
// cards — reusable cards shared by the widget, the legacy dashboard and (in
// the IM shell) the chat stream / context panel.
// Extracted verbatim from App.tsx (S1 atomic move); no logic changes.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { MesaAgentRun, MesaTask } from '@agentmesa/protocol';
import type { RuntimeConfig, WorkflowState } from './types.js';
import { updateRunStatus } from './api.js';
import { runStateLabels } from './ui.js';

export function ProgressBar({ run }: { run: MesaAgentRun }) {
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

export function RunCard({ run, compact = false, onSelect }: { run: MesaAgentRun; compact?: boolean; onSelect?: (run: MesaAgentRun) => void }) {
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

export function ApprovalCard({
  workflow,
  task,
  onDecide,
  fresh = false,
}: {
  workflow: WorkflowState;
  task?: MesaTask;
  onDecide: (decision: 'approve' | 'reject', message?: string) => Promise<void>;
  fresh?: boolean;
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
    <article className={`approval-card ${fresh ? 'msg-enter' : ''}`}>
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

export function RunDetailView({
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
