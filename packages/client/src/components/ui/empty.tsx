import type { ComponentType } from 'react';
import { Button } from './button.js';
import { ChatsCircle } from './icons.js';

export function EmptyState({
  title,
  detail,
  action,
  icon: Icon = ChatsCircle,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
  icon?: ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; className?: string }>;
}) {
  return (
    <div className="empty-state">
      <Icon size={26} className="empty-state__icon" />
      <strong>{title}</strong>
      <p>{detail}</p>
      {action ? (
        <Button variant="primary" small className="empty-state__action" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
