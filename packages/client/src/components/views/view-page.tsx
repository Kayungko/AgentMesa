import type { ReactNode } from 'react';

export function ViewPage({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="chat-main chat-main--page view-page">
      <header className="view-page__head">
        <h1>{title}{typeof count === 'number' ? <small>{count}</small> : null}</h1>
        {actions ? <div className="view-page__actions">{actions}</div> : null}
      </header>
      <div className="view-page__body">{children}</div>
    </section>
  );
}
