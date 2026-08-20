import { useEffect, useRef } from 'react';
import { IconButton } from '../ui/icon-button.js';
import { At, PaperPlaneTilt, Paperclip } from '../ui/icons.js';

/** The composer: an auto-growing textarea; Enter 发送、Shift+Enter 换行. */
export function Composer({
  placeholder,
  value,
  onChange,
  onSend,
  sending = false,
  onStub,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => Promise<void> | void;
  sending?: boolean;
  /** Placeholder affordances (attachment / mention) are not wired yet. */
  onStub?: (label: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  return (
    <footer className="composer-wrap">
      <div className="composer">
        <IconButton label="添加附件" onClick={() => onStub?.('添加附件')}><Paperclip size={17} /></IconButton>
        <IconButton label="提及 Agent" onClick={() => onStub?.('提及 Agent')}><At size={17} /></IconButton>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          aria-label="消息内容"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
        />
        <button
          className="send-button"
          type="button"
          aria-label="发送消息"
          disabled={!value.trim() || sending}
          onClick={() => void onSend()}
        >
          <PaperPlaneTilt size={16} weight="fill" />
        </button>
      </div>
      <small>Enter 发送 · Shift + Enter 换行</small>
    </footer>
  );
}
