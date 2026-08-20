export function SemanticDot({
  tone,
  pulse = false,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info' | 'muted';
  pulse?: boolean;
}) {
  return <i className={`semantic-dot semantic-dot--${tone} ${pulse ? 'semantic-dot--pulse' : ''}`} />;
}
