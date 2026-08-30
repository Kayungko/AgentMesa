import { useState } from 'react';
import type { PendingPermissionApproval } from '../../types.js';
import { Button } from '../ui/button.js';
import { SemanticDot } from '../ui/semantic-dot.js';

const KIND_LABEL: Record<PendingPermissionApproval['kind'], string> = {
  tool: '工具调用',
  command: '命令执行',
  patch: '文件补丁',
};

/**
 * Lightweight variant of ApprovalCard for driver permission requests (the
 * desk askHuman bridge). Workflow approvals carry a message channel and task
 * context; permission requests only carry allow/deny — so a separate card
 * instead of shoehorning the workflow shape.
 */
export function PermissionApprovalCard({
  approval,
  onDecide,
  fresh = false,
}: {
  approval: PendingPermissionApproval;
  onDecide: (decision: 'allow' | 'deny') => Promise<void>;
  fresh?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (decision: 'allow' | 'deny') => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onDecide(decision);
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
          <small>需要你的确认 · {KIND_LABEL[approval.kind]}</small>
          <strong>{approval.title}</strong>
          {approval.resource
            ? <span className="approval-card__taskid">{approval.resource}</span>
            : null}
        </div>
      </div>
      {approval.reason ? <p className="approval-card__reason">{approval.reason}</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="approval-card__actions">
        <Button disabled={submitting} onClick={() => void submit('deny')}>拒绝</Button>
        <Button variant="primary" disabled={submitting} onClick={() => void submit('allow')}>允许</Button>
      </div>
    </article>
  );
}
