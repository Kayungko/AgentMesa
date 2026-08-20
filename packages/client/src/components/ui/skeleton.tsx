export function SkeletonStack({ count, compact = false }: { count: number; compact?: boolean }) {
  return (
    <div className="stack">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton ${compact ? 'skeleton--compact' : ''}`} />
      ))}
    </div>
  );
}
