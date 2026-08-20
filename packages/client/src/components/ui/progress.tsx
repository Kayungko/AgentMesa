export function ProgressBar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span className="progress-track" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${width}%` }} />
    </span>
  );
}
