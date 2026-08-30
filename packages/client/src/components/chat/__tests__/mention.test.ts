import { describe, expect, it } from 'vitest';
import type { RoomMember } from '@agentmesa/protocol';
import {
  collectMentionRefs,
  filterMentionCandidates,
  findMentionStart,
  mentionableMembers,
  memberLabel,
  splitMentionSegments,
} from '../mention.js';

// ---------------------------------------------------------------------------
// M2 @mention 协作语义（纯函数）：选择器候选、@ 触发定位、文本切分高亮、
// 发送时 mentions 提取。分组逻辑（room-grouping.ts）不在本文件范围。
// ---------------------------------------------------------------------------

function member(input: {
  kind?: 'session' | 'agent' | 'human';
  ref: string;
  label?: string;
  roles?: string[];
  workspaceId?: string;
}): RoomMember {
  return {
    workspaceId: input.workspaceId ?? 'ws-a',
    kind: input.kind ?? 'agent',
    ref: input.ref,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...(input.label ? { label: input.label } : {}),
    ...(input.roles ? { roles: input.roles } : {}),
  };
}

const members: RoomMember[] = [
  member({ ref: 'claude', label: 'Claude', roles: ['planner'] }),
  member({ ref: 'codex', label: 'Codex' }),
  member({ ref: 'helper', label: '小助手' }),
  member({ kind: 'human', ref: 'user', label: '我' }),
];

describe('mentionableMembers', () => {
  it('排除操作者自己（kind human + ref user），保留其他人类成员', () => {
    const others = [...members, member({ kind: 'human', ref: 'alice', label: 'Alice' })];
    const result = mentionableMembers(others);
    expect(result.map((m) => m.ref)).toEqual(['claude', 'codex', 'helper', 'alice']);
  });

  it('空成员列表返回空数组', () => {
    expect(mentionableMembers([])).toEqual([]);
  });
});

describe('memberLabel', () => {
  it('label 优先，缺省回退 ref', () => {
    expect(memberLabel(members[0]!)).toBe('Claude');
    expect(memberLabel(member({ ref: 'raw-id' }))).toBe('raw-id');
  });
});

describe('filterMentionCandidates', () => {
  it('空查询返回全部候选', () => {
    expect(filterMentionCandidates('', members)).toHaveLength(4);
  });

  it('按 label 或 ref 子串过滤（大小写不敏感）', () => {
    const result = filterMentionCandidates('cl', members);
    expect(result.map((m) => m.ref)).toEqual(['claude']);
    // label 不含但 ref 含：label「小助手」/ ref「helper」
    expect(filterMentionCandidates('hel', members).map((m) => m.ref)).toEqual(['helper']);
  });

  it('中文查询可命中中文 label', () => {
    expect(filterMentionCandidates('助手', members).map((m) => m.ref)).toEqual(['helper']);
  });
});

describe('findMentionStart', () => {
  it('光标处于 @ 查询词内时返回 @ 下标', () => {
    expect(findMentionStart('hi @Cl', 6)).toBe(3);
    expect(findMentionStart('@', 1)).toBe(0);
  });

  it('光标越过空格（查询已结束）返回 null', () => {
    expect(findMentionStart('hi @Claude ', 11)).toBeNull();
  });

  it('内嵌 @（如邮箱）不触发', () => {
    expect(findMentionStart('a@b.com', 7)).toBeNull();
  });

  it('无 @ 时返回 null', () => {
    expect(findMentionStart('hello', 5)).toBeNull();
  });
});

describe('splitMentionSegments', () => {
  it('按成员 label 切分出 mention 片段', () => {
    const segments = splitMentionSegments('hi @Claude 帮我看下', members);
    expect(segments).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@Claude', member: members[0] },
      { kind: 'text', text: ' 帮我看下' },
    ]);
  });

  it('串首 @ 与中文成员名可命中', () => {
    const segments = splitMentionSegments('@小助手 跑一下测试', members);
    expect(segments[0]).toMatchObject({ kind: 'mention', text: '@小助手' });
    expect(segments[1]).toMatchObject({ kind: 'text', text: ' 跑一下测试' });
  });

  it('长 label 优先匹配（Claude Code 先于 Claude）', () => {
    const withLong: RoomMember[] = [
      member({ ref: 'claude', label: 'Claude' }),
      member({ ref: 'cc', label: 'Claude Code' }),
    ];
    const segments = splitMentionSegments('@Claude Code 负责', withLong);
    expect(segments[0]).toMatchObject({ kind: 'mention', text: '@Claude Code' });
  });

  it('内嵌 @（邮箱）不误命中', () => {
    const segments = splitMentionSegments('邮箱 a@claude.com 收到没', members);
    expect(segments).toEqual([{ kind: 'text', text: '邮箱 a@claude.com 收到没' }]);
  });

  it('未匹配到的 @名字 保持纯文本', () => {
    expect(splitMentionSegments('@Nobody 在吗', members)).toEqual([
      { kind: 'text', text: '@Nobody 在吗' },
    ]);
  });

  it('多个 mention 与纯文本交替', () => {
    const segments = splitMentionSegments('@Claude 交给 @Codex 处理', members);
    expect(segments.map((s) => s.text)).toEqual(['@Claude', ' 交给 ', '@Codex', ' 处理']);
    expect(segments.filter((s) => s.kind === 'mention')).toHaveLength(2);
  });

  it('成员列表为空时原样返回', () => {
    expect(splitMentionSegments('@Claude 在吗', [])).toEqual([{ kind: 'text', text: '@Claude 在吗' }]);
  });
});

describe('collectMentionRefs', () => {
  it('提取被 @ 成员的 ref，去重并保持出现顺序', () => {
    expect(collectMentionRefs('@Codex @Claude @Codex 看下', members)).toEqual(['codex', 'claude']);
  });

  it('手打的 mention（未走选择器）同样命中', () => {
    expect(collectMentionRefs('请 @小助手 跑测试', members)).toEqual(['helper']);
  });

  it('无 mention 时返回空数组', () => {
    expect(collectMentionRefs('没有提及任何人', members)).toEqual([]);
    expect(collectMentionRefs('@Unknown 随便说的', members)).toEqual([]);
  });
});
