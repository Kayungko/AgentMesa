import { useState } from 'react';
import type { MesaTask } from '@agentmesa/protocol';
import type { WorkflowState } from '../../types.js';
import { Button } from '../ui/button.js';
import { SemanticDot } from '../ui/semantic-dot.js';

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
        <SemanticDot tone="warning" />
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
        <Button disabled={submitting} onClick={() => void submit('reject')}>拒绝</Button>
        <Button variant="primary" disabled={submitting} onClick={() => void submit('approve')}>批准</Button>
      </div>
    </article>
  );
}
