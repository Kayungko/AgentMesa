import { useState } from 'react';
import { createRoom } from '../../api.js';
import type { RuntimeConfig } from '../../types.js';
import { Button } from '../ui/button.js';
import { Modal } from './modal.js';

export function CreateRoomDialog({
  config,
  onCreated,
  onClose,
}: {
  config: RuntimeConfig;
  onCreated: (roomId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const room = await createRoom(config, {
        name: trimmed,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      });
      onCreated(room.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <Modal title="新建群聊" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="dialog-field">
          <span>群聊名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：发布评审"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="dialog-field">
          <span>主题/目的（可选）</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="例如：评审 7 月版登录重构"
            spellCheck={false}
          />
        </label>
        {error ? <p className="inline-error">{error}</p> : null}
        <footer>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? '创建中…' : '建群'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
