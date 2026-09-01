import type { MesaMeeting } from '@agentmesa/protocol';

/**
 * 会话列表分组（纯前端逻辑）：成组导入的会议按 `metadata.groupName` 聚合。
 * 组头插在该组第一条会议之前（排序不变，只插入组头标记）；每个组只出现
 * 一次组头，无组的会议与群聊不插入任何标记。
 */

/** 渲染条目：组头或一行会话/群聊。 */
export type ConvRenderItem<T> =
  | { type: 'group'; name: string; key: string }
  | { type: 'row'; row: T; key: string };

/** Read the group label off a meeting's metadata (unknown by schema). */
export function meetingGroupName(meeting: Pick<MesaMeeting, 'metadata'>): string | undefined {
  const groupName = meeting.metadata?.groupName;
  return typeof groupName === 'string' && groupName.length > 0 ? groupName : undefined;
}

/**
 * Annotate already-sorted rows (meetings + rooms, newest first) with group
 * headers. Row order is preserved verbatim — the group header simply lands
 * in front of the first row of each group, so a group's position follows its
 * newest member.
 */
export function groupConvRows<T extends { kind: 'meeting' | 'room'; id: string; meeting?: Pick<MesaMeeting, 'metadata'> }>(
  rows: readonly T[],
): ConvRenderItem<T>[] {
  const items: ConvRenderItem<T>[] = [];
  const seenGroups = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'meeting' && row.meeting) {
      const groupName = meetingGroupName(row.meeting);
      if (groupName !== undefined && !seenGroups.has(groupName)) {
        seenGroups.add(groupName);
        items.push({ type: 'group', name: groupName, key: `group:${groupName}` });
      }
    }
    items.push({ type: 'row', row, key: `${row.kind}:${row.id}` });
  }
  return items;
}
