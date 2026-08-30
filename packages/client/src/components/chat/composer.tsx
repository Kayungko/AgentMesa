import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import type { RoomMember } from '@agentmesa/protocol';
import { Avatar } from '../ui/avatar.js';
import { IconButton } from '../ui/icon-button.js';
import { At, PaperPlaneTilt, Paperclip } from '../ui/icons.js';
import { filterMentionCandidates, findMentionStart, memberLabel } from './mention.js';

/** The composer: an auto-growing textarea; Enter 发送、Shift+Enter 换行.
 * 传入 mentionMembers 时启用 @ 提及选择器（M2 协作语义）。 */
export function Composer({
  placeholder,
  value,
  onChange,
  onSend,
  sending = false,
  onStub,
  mentionMembers,
  onMentionPick,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => Promise<void> | void;
  sending?: boolean;
  /** Placeholder affordances (attachment) are not wired yet. */
  onStub?: (label: string) => void;
  /** 可 @ 的成员（已由调用方排除操作者自己）；不传则 @ 选择器不启用。 */
  mentionMembers?: RoomMember[];
  /** 从选择器选中成员时回调（调用方维护 selectedMentions 状态）。 */
  onMentionPick?: (member: RoomMember) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  // @ 选择器状态：'@' 触发下标 + 光标位置（用于计算过滤词）。
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // 插入 @名字 后需要恢复的光标位置（值受控于父组件，等重渲染后再设）。
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  // 值被外部重置（如发送完成清空）时关闭选择器。
  useEffect(() => {
    if (mentionStart !== null && value[mentionStart] !== '@') setMentionStart(null);
  }, [value, mentionStart]);

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    taRef.current?.setSelectionRange(pos, pos);
  }, [value]);

  const mentionEnabled = mentionMembers !== undefined;
  const mentionOpen = mentionEnabled && mentionStart !== null && value[mentionStart] === '@';
  const query = mentionOpen && mentionStart !== null ? value.slice(mentionStart + 1, caret) : '';
  const candidates = mentionOpen ? filterMentionCandidates(query, mentionMembers ?? []) : [];
  const activeCandidate = candidates[Math.min(activeIndex, Math.max(candidates.length - 1, 0))];

  /** 光标变化（输入 / 点击 / 方向键移动）后同步选择器状态。 */
  const syncCaret = (text: string, position: number) => {
    setCaret(position);
    setMentionStart(mentionEnabled ? findMentionStart(text, position) : null);
    setActiveIndex(0);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const position = event.target.selectionStart ?? next.length;
    onChange(next);
    syncCaret(next, position);
  };

  const syncFromElement = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    syncCaret(el.value, el.selectionStart ?? el.value.length);
  };

  /** 选中成员：把 '@查询词' 替换为 '@名字 '，光标落在名字后。 */
  const pickMention = (member: RoomMember) => {
    if (mentionStart === null || !mentionOpen) return;
    const insert = `@${memberLabel(member)} `;
    const head = value.slice(0, mentionStart);
    const tail = value.slice(caret);
    const next = `${head}${insert}${tail}`;
    const position = head.length + insert.length;
    onChange(next);
    onMentionPick?.(member);
    setMentionStart(null);
    setCaret(position);
    setActiveIndex(0);
    pendingCaretRef.current = position;
    taRef.current?.focus();
  };

  /** @ 按钮 = 插入 '@' 并触发选择器（等于在光标处输入了一个 @）。 */
  const openMentionPicker = () => {
    const el = taRef.current;
    if (!el) return;
    el.focus();
    if (mentionOpen) return;
    const position = el.selectionStart ?? el.value.length;
    const next = `${value.slice(0, position)}@${value.slice(position)}`;
    onChange(next);
    setMentionStart(position);
    setCaret(position + 1);
    setActiveIndex(0);
    pendingCaretRef.current = position + 1;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && candidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((activeIndex + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((activeIndex + candidates.length - 1) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (activeCandidate) pickMention(activeCandidate);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionStart(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  };

  return (
    <footer className="composer-wrap">
      <div className="composer">
        <IconButton label="添加附件" onClick={() => onStub?.('添加附件')}><Paperclip size={17} /></IconButton>
        <IconButton
          label="提及成员"
          onClick={mentionEnabled ? openMentionPicker : () => onStub?.('提及成员')}
        >
          <At size={17} />
        </IconButton>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          aria-label="消息内容"
          onChange={handleChange}
          onClick={syncFromElement}
          onKeyUp={syncFromElement}
          onBlur={() => setMentionStart(null)}
          onKeyDown={handleKeyDown}
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

      {mentionOpen ? (
        <div className="mention-menu" role="listbox" aria-label="选择要提及的成员">
          {candidates.length === 0 ? (
            <div className="mention-menu__empty">没有匹配的成员</div>
          ) : (
            candidates.map((member, index) => {
              const label = memberLabel(member);
              const key = `${member.workspaceId}|${member.kind}|${member.ref}`;
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`mention-menu__option ${index === activeIndex ? 'is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(member)}
                >
                  <Avatar
                    name={label}
                    agentId={`${member.workspaceId}:${member.ref}`}
                    kind={member.kind === 'human' ? 'human' : 'agent'}
                    size="sm"
                  />
                  <span className="mention-menu__name">{label}</span>
                  {member.roles?.[0] ? (
                    <em className="mention-menu__role">{member.roles[0]}</em>
                  ) : null}
                  {member.label && member.label !== member.ref ? (
                    <small className="mention-menu__ref">{member.ref}</small>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}

      <small>Enter 发送 · Shift + Enter 换行{mentionEnabled ? ' · @ 提及成员' : ''}</small>
    </footer>
  );
}
