import { describe, expect, it } from 'vitest';
import { currentProtocolVersion } from '@agentmesa/protocol';
import type { RoomMessage } from '@agentmesa/protocol';
import {
  agentRunSummary,
  groupRoomMessages,
  memberKey,
  SYSTEM_MESSAGE_TYPES,
} from '../room-grouping.js';

// ---------------------------------------------------------------------------
// 群聊防刷屏分组（纯前端逻辑）：agent 互答折叠 + 系统事件时间线。
// ---------------------------------------------------------------------------

let seq = 0;

function message(input: {
  from: { kind: 'session' | 'agent' | 'human'; ref: string; label?: string };
  type?: string;
  summary?: string;
}): RoomMessage {
  seq += 1;
  const iso = new Date(2026, 0, 1, 10, 0, seq).toISOString();
  return {
    protocolVersion: currentProtocolVersion,
    id: `msg-${seq}`,
    roomId: 'room-1',
    workspaceId: 'ws-a',
    from: { workspaceId: 'ws-a', ...input.from },
    type: input.type ?? 'general',
    summary: input.summary ?? `消息 ${seq}`,
    createdAt: iso,
  };
}

describe('groupRoomMessages', () => {
  it('连续 ≥3 条非人类 general 消息折叠为一个 agent-run', () => {
    const items = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude', label: 'Claude' } }),
      message({ from: { kind: 'agent', ref: 'codex', label: 'Codex' } }),
      message({ from: { kind: 'agent', ref: 'claude', label: 'Claude' } }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'agent-run' });
    if (items[0]!.kind === 'agent-run') expect(items[0]!.messages).toHaveLength(3);
  });

  it('不足 3 条的连续 agent 消息逐条展示', () => {
    const items = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'codex' } }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['single', 'single']);
  });

  it('人类消息作为分组边界打断折叠', () => {
    const items = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'codex' } }),
      message({ from: { kind: 'human', ref: 'user', label: '我' } }),
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'codex' } }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['single', 'single', 'single', 'single', 'single']);
  });

  it('关键类型消息（review_request 等）是边界且不折叠', () => {
    const items = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'review_request' }),
      message({ from: { kind: 'agent', ref: 'codex' } }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['single', 'single', 'single']);
  });

  it('连续 ≥2 条系统类消息折叠为 system-events，单条直接展示', () => {
    const single = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'status_update' }),
    ]);
    expect(single.map((item) => item.kind)).toEqual(['single']);

    const grouped = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'task_created' }),
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'status_changed' }),
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'status_update' }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: 'system-events' });
    if (grouped[0]!.kind === 'system-events') expect(grouped[0]!.messages).toHaveLength(3);
  });

  it('系统消息打断 agent 互答的连续性', () => {
    const items = groupRoomMessages([
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'claude' }, type: 'status_update' }),
      message({ from: { kind: 'agent', ref: 'claude' } }),
      message({ from: { kind: 'agent', ref: 'claude' } }),
    ]);
    // agent(1) + system(1) + agent(2) → 全部 single，无 agent-run。
    expect(items.map((item) => item.kind)).toEqual(['single', 'single', 'single', 'single']);
  });

  it('系统类 type 集合覆盖 task_created / status_changed / task_assignment / status_update', () => {
    expect([...SYSTEM_MESSAGE_TYPES].sort()).toEqual(
      ['status_changed', 'status_update', 'task_assignment', 'task_created'],
    );
  });
});

describe('agentRunSummary', () => {
  it('两位成员 → 「A ↔ B 交流了 N 轮」', () => {
    const messages = [
      message({ from: { kind: 'agent', ref: 'claude', label: 'Claude' } }),
      message({ from: { kind: 'agent', ref: 'codex', label: 'Codex' } }),
      message({ from: { kind: 'agent', ref: 'claude', label: 'Claude' } }),
    ];
    expect(agentRunSummary(messages)).toBe('Claude ↔ Codex 交流了 3 轮');
  });

  it('单一成员 → 「X 发送了 N 条消息」', () => {
    const messages = [
      message({ from: { kind: 'session', ref: 's1', label: '会话一' } }),
      message({ from: { kind: 'session', ref: 's1', label: '会话一' } }),
    ];
    expect(agentRunSummary(messages)).toBe('会话一 发送了 2 条消息');
  });

  it('三位及以上成员 → 列前两位并给出成员数', () => {
    const messages = [
      message({ from: { kind: 'agent', ref: 'a', label: 'A' } }),
      message({ from: { kind: 'agent', ref: 'b', label: 'B' } }),
      message({ from: { kind: 'agent', ref: 'c', label: 'C' } }),
    ];
    expect(agentRunSummary(messages)).toBe('A、B 等 3 位成员交流了 3 轮');
  });
});

describe('memberKey', () => {
  it('以 workspaceId|kind|ref 三元组为唯一键', () => {
    expect(memberKey({ workspaceId: 'ws-a', kind: 'agent', ref: 'claude' })).toBe('ws-a|agent|claude');
    expect(memberKey({ workspaceId: 'ws-b', kind: 'agent', ref: 'claude' })).not.toBe('ws-a|agent|claude');
  });
});
