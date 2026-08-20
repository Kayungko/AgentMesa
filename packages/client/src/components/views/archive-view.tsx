import { useState } from 'react';
import { updateMeetingStatus } from '../../api.js';
import type { RuntimeConfig } from '../../types.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { StatusChip } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { EmptyState } from '../ui/empty.js';
import { formatTime } from '../ui/format.js';
import { ViewPage } from './view-page.js';

const CLOSED_STATUSES = ['completed', 'archived', 'closed'];

export function ArchiveView({
  config,
  runtime,
  onOpen,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
  onOpen: (meetingId: string) => void;
}) {
  const [error, setError] = useState<string>();
  const closed = runtime.meetings
    .filter((meeting) => CLOSED_STATUSES.includes(meeting.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const restore = async (meetingId: string) => {
    setError(undefined);
    try {
      await updateMeetingStatus(config, meetingId, 'active');
      await runtime.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <ViewPage title="归档" count={closed.length}>
      {error ? <p className="inline-error">{error}</p> : null}
      {closed.length === 0 ? (
        <EmptyState title="没有归档会话" detail="结束或归档的会话会收进这里，随时可以恢复。" />
      ) : (
        <div className="view-list">
          {closed.map((meeting) => (
            <div key={meeting.id} className="view-row">
              <button type="button" className="view-row__open" onClick={() => onOpen(meeting.id)}>
                <strong>{meeting.title}</strong>
                <small>{formatTime(meeting.updatedAt)}</small>
              </button>
              <StatusChip status={meeting.status} />
              <Button small onClick={() => void restore(meeting.id)}>恢复</Button>
            </div>
          ))}
        </div>
      )}
    </ViewPage>
  );
}
