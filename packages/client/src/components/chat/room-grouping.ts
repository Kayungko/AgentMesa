import type { RoomMessage } from '@agentmesa/protocol';

// ---------------------------------------------------------------------------
// 群聊防刷屏分组（COLLAB_VISION M2 的纯前端先行部分）：
//   1. 连续 ≥AGENT_RUN_MIN 条「非人类、非关键类型」的 agent 互答消息 → 可折叠块；
//   2. 系统类 type 的消息 → 折叠时间线（SYSTEM_GROUP_MIN 条起折叠）；
//   人类消息与关键类型消息是分组边界，永不折叠。不依赖任何协议改动。
// ---------------------------------------------------------------------------

/** 系统类消息 type（对照 bubbles.tsx 的 typeLabels 挑选）：归入折叠时间线。 */
export const SYSTEM_MESSAGE_TYPES = new Set([
  'task_created',
  'status_changed',
  'task_assignment',
  'status_update',
]);

/** 关键类型消息：作为分组边界展示，永不折叠。 */
export const KEY_MESSAGE_TYPES = new Set([
  'handoff',
  'review_request',
  'review_result',
  'fix_request',
  'fix_done',
  'test_result',
  'decision',
  'review_feedback',
  'implementation_summary',
  'question',
  'answer',
]);

/** 连续多少条 agent 互答消息才折叠。 */
export const AGENT_RUN_MIN = 3;
/** 连续多少条系统事件才折叠（单条直接展示）。 */
export const SYSTEM_GROUP_MIN = 2;

/** 成员唯一键（与 room-service 的 member 判等口径一致）。 */
export function memberKey(member: { workspaceId: string; kind: string; ref: string }): string {
  return `${member.workspaceId}|${member.kind}|${member.ref}`;
}

export type RoomStreamItem =
  | { kind: 'single'; message: RoomMessage }
  | { kind: 'agent-run'; messages: RoomMessage[] }
  | { kind: 'system-events'; messages: RoomMessage[] };

function isSystem(message: RoomMessage): boolean {
  return SYSTEM_MESSAGE_TYPES.has(message.type);
}

/** 可折叠进 agent 互答块的消息：非人类、非系统、非关键类型（含 general/未知 type）。 */
function isFoldableAgentChat(message: RoomMessage): boolean {
  return (
    message.from.kind !== 'human' &&
    !SYSTEM_MESSAGE_TYPES.has(message.type) &&
    !KEY_MESSAGE_TYPES.has(message.type)
  );
}

/**
 * 把消息流分组为渲染项序列。顺序与输入一致；系统事件会打断 agent 互答的连续性。
 */
export function groupRoomMessages(messages: RoomMessage[]): RoomStreamItem[] {
  const items: RoomStreamItem[] = [];
  let agentRun: RoomMessage[] = [];
  let systemRun: RoomMessage[] = [];

  const flushAgentRun = () => {
    if (agentRun.length === 0) return;
    if (agentRun.length >= AGENT_RUN_MIN) {
      items.push({ kind: 'agent-run', messages: agentRun });
    } else {
      for (const message of agentRun) items.push({ kind: 'single', message });
    }
    agentRun = [];
  };
  const flushSystemRun = () => {
    if (systemRun.length === 0) return;
    if (systemRun.length >= SYSTEM_GROUP_MIN) {
      items.push({ kind: 'system-events', messages: systemRun });
    } else {
      for (const message of systemRun) items.push({ kind: 'single', message });
    }
    systemRun = [];
  };

  for (const message of messages) {
    if (isSystem(message)) {
      flushAgentRun();
      systemRun.push(message);
      continue;
    }
    flushSystemRun();
    if (isFoldableAgentChat(message)) {
      agentRun.push(message);
      continue;
    }
    // 人类消息 / 关键类型消息：分组边界。
    flushAgentRun();
    items.push({ kind: 'single', message });
  }
  flushAgentRun();
  flushSystemRun();
  return items;
}

/** 折叠块的一行摘要，如「Claude ↔ Codex 交流了 5 轮」。 */
export function agentRunSummary(messages: RoomMessage[]): string {
  const names: string[] = [];
  for (const message of messages) {
    const label = message.from.label ?? message.from.ref;
    if (!names.includes(label)) names.push(label);
  }
  const turns = messages.length;
  if (names.length === 1) return `${names[0]} 发送了 ${turns} 条消息`;
  if (names.length === 2) return `${names[0]} ↔ ${names[1]} 交流了 ${turns} 轮`;
  return `${names[0]}、${names[1]} 等 ${names.length} 位成员交流了 ${turns} 轮`;
}
