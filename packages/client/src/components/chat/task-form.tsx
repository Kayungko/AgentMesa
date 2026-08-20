import { useState } from 'react';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { Button } from '../ui/button.js';

export function TaskForm({
  runtime,
  meetingId,
  onCancel,
  onCreated,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  meetingId?: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await runtime.createTaskInSession({
        title: trimmed,
        ...(meetingId ? { meetingId } : {}),
        ...(assignee ? { assignedTo: assignee } : {}),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <form className="task-create" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="任务标题，例如：实现 QR 登录接口"
        spellCheck={false}
        autoFocus
      />
      <select value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="指派给">
        <option value="">指派给…</option>
        {runtime.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <Button variant="primary" small type="submit" disabled={busy || !title.trim()}>
        {busy ? '创建中…' : '创建'}
      </Button>
      <Button small onClick={onCancel} disabled={busy}>取消</Button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}
