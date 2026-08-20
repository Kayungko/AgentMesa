import { useState } from 'react';
import { updateTaskStatus } from '../../api.js';
import type { RuntimeConfig } from '../../types.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { TASK_STATUSES, statusClass } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { EmptyState } from '../ui/empty.js';
import { formatTime } from '../ui/format.js';
import { TaskForm } from '../chat/task-form.js';
import { ViewPage } from './view-page.js';

export function TasksView({
  config,
  runtime,
}: {
  config: RuntimeConfig;
  runtime: ReturnType<typeof useMesaRuntime>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string>();

  const tasks = [...runtime.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const changeStatus = async (taskId: string, status: string) => {
    setError(undefined);
    try {
      await updateTaskStatus(config, taskId, status);
      await runtime.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <ViewPage
      title="任务"
      count={tasks.length}
      actions={<Button small onClick={() => setFormOpen((v) => !v)}>{formOpen ? '收起' : '新建任务'}</Button>}
    >
      {error ? <p className="inline-error">{error}</p> : null}
      {formOpen ? (
        <TaskForm runtime={runtime} onCancel={() => setFormOpen(false)} onCreated={() => setFormOpen(false)} />
      ) : null}
      {tasks.length === 0 ? (
        <EmptyState title="还没有任务" detail="新建任务并指派 Agent，让协作开工。" />
      ) : (
        <div className="view-list">
          {tasks.map((task) => (
            <div key={task.id} className="view-row">
              <select
                className={`task-status-select ${statusClass(task.status)}`}
                value={task.status}
                onChange={(event) => void changeStatus(task.id, event.target.value)}
                aria-label={`${task.title} 状态`}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <div className="view-row__body">
                <strong>{task.title}</strong>
                <small>{formatTime(task.updatedAt)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </ViewPage>
  );
}
