import { describe, expect, it } from 'vitest';
import type { MesaMeeting } from '@agentmesa/protocol';
import { groupConvRows, meetingGroupName } from '../conv-grouping.js';

// ---------------------------------------------------------------------------
// 会话列表分组（纯前端逻辑）：成组导入的会议按 groupName 聚合插组头。
// ---------------------------------------------------------------------------

interface Row {
  kind: 'meeting' | 'room';
  id: string;
  meeting?: Pick<MesaMeeting, 'metadata'>;
}

function meetingRow(id: string, groupName?: string): Row {
  return {
    kind: 'meeting',
    id,
    meeting: {
      metadata: groupName !== undefined ? { groupName } : undefined,
    },
  };
}

function roomRow(id: string): Row {
  return { kind: 'room', id };
}

function shape(items: ReturnType<typeof groupConvRows<Row>>): string {
  return items
    .map((item) => (item.type === 'group' ? `[${item.name}]` : item.row.id))
    .join(' ');
}

describe('meetingGroupName', () => {
  it('reads the group label off meeting metadata', () => {
    expect(meetingGroupName({ metadata: { groupName: '总控接管' } })).toBe('总控接管');
  });

  it('tolerates missing / empty / non-string labels', () => {
    expect(meetingGroupName({ metadata: undefined })).toBeUndefined();
    expect(meetingGroupName({ metadata: {} })).toBeUndefined();
    expect(meetingGroupName({ metadata: { groupName: '' } })).toBeUndefined();
    expect(meetingGroupName({ metadata: { groupName: 42 } })).toBeUndefined();
  });
});

describe('groupConvRows', () => {
  it('inserts one group header before the first member of each group, order preserved', () => {
    const items = groupConvRows<Row>([
      meetingRow('m1', '组A'),
      meetingRow('m2', '组A'),
      meetingRow('m3'),
      meetingRow('m4', '组B'),
    ]);
    expect(shape(items)).toBe('[组A] m1 m2 m3 [组B] m4');
    expect(items[0]).toMatchObject({ type: 'group', key: 'group:组A' });
    expect(items[1]).toMatchObject({ type: 'row', key: 'meeting:m1' });
  });

  it('leaves ungrouped meetings and rooms untouched', () => {
    const items = groupConvRows<Row>([
      roomRow('r1'),
      meetingRow('m1'),
      meetingRow('m2', '组A'),
      roomRow('r2'),
      meetingRow('m3', '组A'),
    ]);
    expect(shape(items)).toBe('r1 m1 [组A] m2 r2 m3');
  });

  it('handles interleaved groups (header only on first sight)', () => {
    const items = groupConvRows<Row>([
      meetingRow('m1', '组A'),
      meetingRow('m2', '组B'),
      meetingRow('m3', '组A'),
    ]);
    expect(shape(items)).toBe('[组A] m1 [组B] m2 m3');
  });

  it('returns plain rows when nothing is grouped', () => {
    const items = groupConvRows<Row>([roomRow('r1'), meetingRow('m1')]);
    expect(items.every((item) => item.type === 'row')).toBe(true);
    expect(items).toHaveLength(2);
  });
});
