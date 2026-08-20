import type { MesaAgentRun } from '@agentmesa/protocol';
import { runStateLabels } from '../ui/badge.js';
import { SemanticDot } from '../ui/semantic-dot.js';

/** Deterministic state indicator — no fake percentages (the protocol carries
 *  no runner-reported progress fields yet). */
export function RunProgress({ run }: { run: MesaAgentRun }) {
  const label = runStateLabels[run.status] ?? run.status;
  const tone = run.status === 'completed' ? 'success'
    : run.status === 'failed' ? 'danger'
      : run.status === 'cancelled' ? 'muted'
        : run.status === 'running' ? 'info'
          : 'muted';
  return (
    <span className={`run-progress run-progress--${run.status}`} role="status" aria-label={label}>
      <SemanticDot tone={tone} pulse={run.status === 'running'} />
      <span>{label}</span>
    </span>
  );
}

export function RunCard({
  run,
  compact = false,
  onSelect,
}: {
  run: MesaAgentRun;
  compact?: boolean;
  onSelect?: (run: MesaAgentRun) => void;
}) {
  return (
    <button
      className={`run-card ${compact ? 'run-card--compact' : ''}`}
      onClick={() => onSelect?.(run)}
      type="button"
    >
      <span className="run-card__topline">
        <span className="run-card__agent">{run.agentId}</span>
        <RunProgress run={run} />
      </span>
      <strong>{run.outputSummary || run.input || run.action}</strong>
    </button>
  );
}
