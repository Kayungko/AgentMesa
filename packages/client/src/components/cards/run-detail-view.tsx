import { useState } from 'react';
import type { MesaAgentRun } from '@agentmesa/protocol';
import { updateRunStatus } from '../../api.js';
import type { RuntimeConfig } from '../../types.js';
import { Button } from '../ui/button.js';
import { IconButton } from '../ui/icon-button.js';
import { X } from '../ui/icons.js';
import { RunProgress } from './run-card.js';

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
          <RunProgress run={run} />
        </div>
        <div className="entity-detail__head-actions">
          {cancellable ? (
            <Button variant="danger" small onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? '取消中…' : '取消运行'}
            </Button>
          ) : null}
          <IconButton label="关闭" onClick={onClose}><X size={15} /></IconButton>
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
