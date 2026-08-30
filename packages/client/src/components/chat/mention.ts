import type { RoomMember } from '@agentmesa/protocol';

// ---------------------------------------------------------------------------
// @mention 协作语义（COLLAB_VISION M2）：纯函数集合 —— 选择器候选过滤、
// 「正在输入的 @」定位、summary 文本切分高亮、发送时 mentions 提取。
// 不依赖 React，便于单测；UI 接线见 composer.tsx / bubbles.tsx / room-chat.tsx。
// ---------------------------------------------------------------------------

/** 成员展示名（与气泡渲染口径一致：label 优先，缺省回退 ref）。 */
export function memberLabel(member: RoomMember): string {
  return member.label ?? member.ref;
}

/**
 * 可被 @ 的成员：房间成员里排除操作者自己（kind 'human' + ref 'user'）。
 * 其他人类成员（若被邀请进群）仍可被提及。
 */
export function mentionableMembers(members: RoomMember[]): RoomMember[] {
  return members.filter((member) => !(member.kind === 'human' && member.ref === 'user'));
}

/** 选择器候选过滤：label / ref 包含查询串（大小写不敏感）。 */
export function filterMentionCandidates(query: string, members: RoomMember[]): RoomMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  return members.filter(
    (member) =>
      memberLabel(member).toLowerCase().includes(q) || member.ref.toLowerCase().includes(q),
  );
}

/** label 按长度倒序：长名优先匹配（"Claude Code" 先于 "Claude"）。 */
function sortedByLabelLength(members: RoomMember[]): RoomMember[] {
  return [...members].sort((a, b) => memberLabel(b).length - memberLabel(a).length);
}

/** '@' 触发合法：位于串首，或前一字符是空白（避免命中邮箱等内嵌 @）。 */
function atTriggerValid(text: string, index: number): boolean {
  return index === 0 || /\s/.test(text[index - 1]!);
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; member: RoomMember };

/**
 * 把 summary 切分为「纯文本 + @mention」片段序列，供气泡高亮渲染。
 * 最简实现（M2 约定）：按成员 label 精确匹配 '@名字'，长名优先。
 */
export function splitMentionSegments(text: string, members: RoomMember[]): MentionSegment[] {
  if (!text.includes('@') || members.length === 0) return [{ kind: 'text', text }];
  const sorted = sortedByLabelLength(members);
  const matchAt = (position: number): RoomMember | undefined => {
    for (const member of sorted) {
      if (text.startsWith(memberLabel(member), position)) return member;
    }
    return undefined;
  };

  const segments: MentionSegment[] = [];
  let buffer = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && atTriggerValid(text, i)) {
      const member = matchAt(i + 1);
      if (member) {
        if (buffer) {
          segments.push({ kind: 'text', text: buffer });
          buffer = '';
        }
        segments.push({ kind: 'mention', text: `@${memberLabel(member)}`, member });
        i += 1 + memberLabel(member).length;
        continue;
      }
    }
    buffer += text[i]!;
    i += 1;
  }
  if (buffer) segments.push({ kind: 'text', text: buffer });
  return segments;
}

/** 发送时从草稿文本提取被 @ 成员的 ref（去重、按首次出现顺序）。 */
export function collectMentionRefs(text: string, members: RoomMember[]): string[] {
  const refs: string[] = [];
  for (const segment of splitMentionSegments(text, members)) {
    if (segment.kind === 'mention' && !refs.includes(segment.member.ref)) {
      refs.push(segment.member.ref);
    }
  }
  return refs;
}

/**
 * 从光标位置向前定位「正在输入的 @」：返回 '@' 的下标，无则 null。
 * 规则：'@' 位于串首或前一字符是空白，且 '@' 到光标之间没有空白。
 */
export function findMentionStart(text: string, caret: number): number | null {
  for (let i = Math.min(caret, text.length) - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (/\s/.test(ch)) return null;
    if (ch === '@') return atTriggerValid(text, i) ? i : null;
  }
  return null;
}
