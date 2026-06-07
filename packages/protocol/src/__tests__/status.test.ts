import { describe, it, expect } from 'vitest';
import {
  isTaskStatus,
  canTransitionTaskStatus,
  assertTaskStatusTransition,
  getAllowedTransitions,
  isTerminalStatus,
  taskStatuses,
} from '../status.js';
import type { TaskStatus } from '../status.js';

describe('isTaskStatus', () => {
  it('returns true for valid statuses', () => {
    for (const status of taskStatuses) {
      expect(isTaskStatus(status)).toBe(true);
    }
  });

  it('returns false for invalid statuses', () => {
    expect(isTaskStatus('unknown')).toBe(false);
    expect(isTaskStatus('')).toBe(false);
    expect(isTaskStatus('IN_PROGRESS')).toBe(false);
  });
});

describe('canTransitionTaskStatus', () => {
  it('allows todo -> in_progress', () => {
    expect(canTransitionTaskStatus('todo', 'in_progress')).toBe(true);
  });

  it('allows in_progress -> ready_for_review', () => {
    expect(canTransitionTaskStatus('in_progress', 'ready_for_review')).toBe(true);
  });

  it('allows reviewing -> changes_requested', () => {
    expect(canTransitionTaskStatus('reviewing', 'changes_requested')).toBe(true);
  });

  it('allows changes_requested -> in_progress', () => {
    expect(canTransitionTaskStatus('changes_requested', 'in_progress')).toBe(true);
  });

  it('allows reviewing -> approved', () => {
    expect(canTransitionTaskStatus('reviewing', 'approved')).toBe(true);
  });

  it('allows approved -> done', () => {
    expect(canTransitionTaskStatus('approved', 'done')).toBe(true);
  });

  it('rejects todo -> done', () => {
    expect(canTransitionTaskStatus('todo', 'done')).toBe(false);
  });

  it('rejects done -> anything', () => {
    for (const status of taskStatuses) {
      if (status !== 'done') {
        expect(canTransitionTaskStatus('done', status)).toBe(false);
      }
    }
  });

  it('rejects cancelled -> anything', () => {
    for (const status of taskStatuses) {
      if (status !== 'cancelled') {
        expect(canTransitionTaskStatus('cancelled', status)).toBe(false);
      }
    }
  });

  it('rejects self-transition', () => {
    expect(canTransitionTaskStatus('todo', 'todo')).toBe(false);
    expect(canTransitionTaskStatus('in_progress', 'in_progress')).toBe(false);
  });
});

describe('assertTaskStatusTransition', () => {
  it('does not throw for valid transition', () => {
    expect(() => assertTaskStatusTransition('todo', 'in_progress')).not.toThrow();
  });

  it('throws for invalid transition', () => {
    expect(() => assertTaskStatusTransition('todo', 'done')).toThrow(
      'Invalid AgentMesa task status transition: todo -> done'
    );
  });
});

describe('getAllowedTransitions', () => {
  it('returns transitions for todo', () => {
    const transitions = getAllowedTransitions('todo');
    expect(transitions).toContain('in_progress');
    expect(transitions).toContain('cancelled');
    expect(transitions).toHaveLength(2);
  });

  it('returns empty array for done', () => {
    expect(getAllowedTransitions('done')).toEqual([]);
  });

  it('returns empty array for cancelled', () => {
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });

  it('returns a copy (not the original array)', () => {
    const a = getAllowedTransitions('todo');
    const b = getAllowedTransitions('todo');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('isTerminalStatus', () => {
  it('done is terminal', () => {
    expect(isTerminalStatus('done')).toBe(true);
  });

  it('cancelled is terminal', () => {
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('in_progress is not terminal', () => {
    expect(isTerminalStatus('in_progress')).toBe(false);
  });

  it('todo is not terminal', () => {
    expect(isTerminalStatus('todo')).toBe(false);
  });
});

describe('full lifecycle', () => {
  it('supports the happy path: todo -> done', () => {
    const flow: TaskStatus[] = [
      'todo',
      'in_progress',
      'ready_for_review',
      'reviewing',
      'approved',
      'done',
    ];

    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransitionTaskStatus(flow[i]!, flow[i + 1]!)).toBe(true);
    }
  });

  it('supports review-fix loop', () => {
    const flow: TaskStatus[] = [
      'todo',
      'in_progress',
      'ready_for_review',
      'reviewing',
      'changes_requested',
      'in_progress',
      'ready_for_review',
      'reviewing',
      'approved',
      'done',
    ];

    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransitionTaskStatus(flow[i]!, flow[i + 1]!)).toBe(true);
    }
  });
});
