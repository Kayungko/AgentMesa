import { useState } from 'react';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { Avatar } from '../ui/avatar.js';
import { Button } from '../ui/button.js';
import { Modal } from './modal.js';

export function CreateSessionDialog({
  runtime,
  onCreated,
  onClose,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  onCreated: (meetingId: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggleAgent = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const meeting = await runtime.createSession({
        title: trimmed,
        purpose: purpose.trim() || undefined,
        agents: picked,
      });
      onCreated(meeting.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <Modal title="新建会话" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="dialog-field">
          <span>会话标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：登录模块重构"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="dialog-field">
          <span>目的（可选）</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="这次会话要协作完成什么"
            spellCheck={false}
          />
        </label>
        <div className="agent-picks">
          <span>参与 Agent</span>
          {runtime.agents.length === 0 ? (
            <p className="ctx-hint">
              还没有注册 Agent——先去「部署」页登记 Agent 身份，或执行 <code>mesa agent add &lt;id&gt; &lt;name&gt;</code>。
            </p>
          ) : (
            runtime.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`agent-chip ${picked.includes(agent.id) ? 'is-selected' : ''}`}
                onClick={() => toggleAgent(agent.id)}
                aria-pressed={picked.includes(agent.id)}
              >
                <Avatar name={agent.name} agentId={agent.id} roles={agent.roles} size="sm" />
                {agent.name}
              </button>
            ))
          )}
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <footer>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
            {busy ? '创建中…' : '创建会话'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
