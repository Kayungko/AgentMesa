import { EmptyState } from '../ui/empty.js';
import { SkeletonStack } from '../ui/skeleton.js';

export function ChatLoading() {
  return (
    <section className="chat-main">
      <SkeletonStack count={3} />
    </section>
  );
}

export function ChatErrorState({ message }: { message?: string }) {
  return (
    <section className="chat-main">
      <div className="error-state">
        <strong>无法加载会话</strong>
        <p>{message ?? '会话不存在或已被移除。'}</p>
      </div>
    </section>
  );
}

export function ChatEmpty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <section className="chat-main">
      <EmptyState title={title} detail={detail} action={action} />
    </section>
  );
}
