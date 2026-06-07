import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace, resetTaskCounter, resetMessageCounter, resetArtifactCounter, resetMeetingCounter } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { MesaTask, MesaMessage, MesaArtifact, MesaMeeting, MesaAgent } from '@agentmesa/protocol';
import {
  handleCreateTask,
  handleListTasks,
  handleReadTask,
  handleUpdateStatus,
  handlePostMessage,
  handleRequestReview,
  handleSubmitReview,
  handleAttachArtifact,
  handleListArtifacts,
  handleListMessages,
  handleCreateMeeting,
  handleListMeetings,
  handleRegisterAgent,
  handleListAgents,
} from '../tools.js';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-mcp-test-'));
  paths = initWorkspace(testDir);
  resetTaskCounter();
  resetMessageCounter();
  resetArtifactCounter();
  resetMeetingCounter();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function parse<T>(result: string): T {
  return JSON.parse(result) as T;
}

describe('handleCreateTask', () => {
  it('creates a task with basic fields', () => {
    const result = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build login', createdBy: 'user' })
    );
    expect(result.id).toBe('T-0001');
    expect(result.title).toBe('Build login');
    expect(result.status).toBe('todo');
    expect(result.createdBy).toBe('user');
  });

  it('creates a task with full context', () => {
    const result = parse<MesaTask>(
      handleCreateTask(paths, {
        title: 'Build login',
        createdBy: 'user',
        assignedTo: 'agent-1',
        reviewer: 'agent-2',
        branch: 'feature/login',
        goal: 'Add login flow',
        changedFiles: ['src/login.ts'],
        commands: ['npm test'],
      })
    );
    expect(result.assignedTo).toBe('agent-1');
    expect(result.reviewer).toBe('agent-2');
    expect(result.branch).toBe('feature/login');
    expect(result.context?.goal).toBe('Add login flow');
    expect(result.context?.changedFiles).toEqual(['src/login.ts']);
    expect(result.context?.commands).toEqual(['npm test']);
  });
});

describe('handleListTasks', () => {
  it('returns empty array when no tasks', () => {
    const result = parse<MesaTask[]>(handleListTasks(paths));
    expect(result).toEqual([]);
  });

  it('lists all tasks', () => {
    handleCreateTask(paths, { title: 'Task 1', createdBy: 'user' });
    handleCreateTask(paths, { title: 'Task 2', createdBy: 'user' });
    const result = parse<MesaTask[]>(handleListTasks(paths));
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Task 1');
    expect(result[1]!.title).toBe('Task 2');
  });
});

describe('handleReadTask', () => {
  it('reads a task by ID', () => {
    const created = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    const result = parse<MesaTask>(handleReadTask(paths, { taskId: created.id }));
    expect(result.id).toBe(created.id);
    expect(result.title).toBe('Build feature');
  });

  it('throws for non-existent task', () => {
    expect(() => handleReadTask(paths, { taskId: 'T-9999' })).toThrow();
  });
});

describe('handleUpdateStatus', () => {
  it('updates task status with valid transition', () => {
    const created = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    const result = parse<MesaTask>(
      handleUpdateStatus(paths, { taskId: created.id, status: 'in_progress' })
    );
    expect(result.status).toBe('in_progress');
  });

  it('throws for invalid transition', () => {
    const created = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    expect(() =>
      handleUpdateStatus(paths, { taskId: created.id, status: 'done' })
    ).toThrow();
  });
});

describe('handlePostMessage', () => {
  it('posts a message to a task', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    const result = parse<MesaMessage>(
      handlePostMessage(paths, {
        taskId: task.id,
        from: 'agent-1',
        type: 'handoff',
        summary: 'Handing off to reviewer',
      })
    );
    expect(result.taskId).toBe(task.id);
    expect(result.from).toBe('agent-1');
    expect(result.type).toBe('handoff');
    expect(result.summary).toBe('Handing off to reviewer');
  });

  it('posts a message with artifact references', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    const result = parse<MesaMessage>(
      handlePostMessage(paths, {
        taskId: task.id,
        from: 'agent-1',
        type: 'review_request',
        summary: 'Ready for review',
        artifactIds: ['A-0001', 'A-0002'],
      })
    );
    expect(result.artifactIds).toEqual(['A-0001', 'A-0002']);
  });
});

describe('handleRequestReview', () => {
  it('creates review request and updates status', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    // Move to in_progress first
    handleUpdateStatus(paths, { taskId: task.id, status: 'in_progress' });

    const result = parse<{ message: MesaMessage; task: MesaTask }>(
      handleRequestReview(paths, {
        taskId: task.id,
        from: 'agent-1',
        to: 'agent-2',
        summary: 'Ready for review',
      })
    );
    expect(result.message.type).toBe('review_request');
    expect(result.task.status).toBe('ready_for_review');
  });
});

describe('handleSubmitReview', () => {
  it('submits approved review', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    handleUpdateStatus(paths, { taskId: task.id, status: 'in_progress' });
    handleRequestReview(paths, {
      taskId: task.id,
      from: 'agent-1',
      summary: 'Ready',
    });
    // Move to reviewing
    handleUpdateStatus(paths, { taskId: task.id, status: 'reviewing' });

    const result = parse<{ message: MesaMessage; task: MesaTask }>(
      handleSubmitReview(paths, {
        taskId: task.id,
        from: 'agent-2',
        summary: 'Looks good',
        verdict: 'approved',
      })
    );
    expect(result.message.type).toBe('review_result');
    expect(result.task.status).toBe('approved');
  });

  it('submits changes_requested review', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    handleUpdateStatus(paths, { taskId: task.id, status: 'in_progress' });
    handleRequestReview(paths, {
      taskId: task.id,
      from: 'agent-1',
      summary: 'Ready',
    });
    handleUpdateStatus(paths, { taskId: task.id, status: 'reviewing' });

    const result = parse<{ message: MesaMessage; task: MesaTask }>(
      handleSubmitReview(paths, {
        taskId: task.id,
        from: 'agent-2',
        summary: 'Needs fixes',
        verdict: 'changes_requested',
      })
    );
    expect(result.task.status).toBe('changes_requested');
  });
});

describe('handleAttachArtifact', () => {
  it('creates an artifact', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    const result = parse<MesaArtifact>(
      handleAttachArtifact(paths, {
        kind: 'implementation_summary',
        taskId: task.id,
        createdBy: 'agent-1',
        content: '# Summary\nImplementation complete.',
        format: 'markdown',
      })
    );
    expect(result.id).toBe('A-0001');
    expect(result.kind).toBe('implementation_summary');
    expect(result.taskId).toBe(task.id);
    expect(result.content).toContain('Implementation complete');
  });

  it('creates artifact with metadata', () => {
    const result = parse<MesaArtifact>(
      handleAttachArtifact(paths, {
        kind: 'review_report',
        createdBy: 'agent-2',
        content: 'Review findings',
        format: 'text',
        metadata: { verdict: 'approved', score: 9 },
      })
    );
    expect(result.metadata).toEqual({ verdict: 'approved', score: 9 });
  });
});

describe('handleListArtifacts', () => {
  it('returns empty array when no artifacts', () => {
    const result = parse<MesaArtifact[]>(handleListArtifacts(paths, {}));
    expect(result).toEqual([]);
  });

  it('lists artifacts filtered by task', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    handleAttachArtifact(paths, {
      kind: 'implementation_summary',
      taskId: task.id,
      createdBy: 'agent-1',
      content: 'Summary 1',
    });
    handleAttachArtifact(paths, {
      kind: 'review_report',
      createdBy: 'agent-2',
      content: 'Report without task',
    });
    const result = parse<MesaArtifact[]>(
      handleListArtifacts(paths, { taskId: task.id })
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.taskId).toBe(task.id);
  });
});

describe('handleListMessages', () => {
  it('lists all messages', () => {
    const task = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Build feature', createdBy: 'user' })
    );
    handlePostMessage(paths, {
      taskId: task.id,
      from: 'agent-1',
      type: 'handoff',
      summary: 'Handing off',
    });
    // createTask also creates a task_created message
    const allMessages = parse<MesaMessage[]>(handleListMessages(paths, {}));
    expect(allMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('filters messages by task', () => {
    const task1 = parse<MesaTask>(
      handleCreateTask(paths, { title: 'Task 1', createdBy: 'user' })
    );
    handleCreateTask(paths, { title: 'Task 2', createdBy: 'user' });
    const result = parse<MesaMessage[]>(
      handleListMessages(paths, { taskId: task1.id })
    );
    expect(result.every((m) => m.taskId === task1.id)).toBe(true);
  });
});

describe('handleCreateMeeting', () => {
  it('creates a meeting', () => {
    const result = parse<MesaMeeting>(
      handleCreateMeeting(paths, { title: 'Sprint Planning' })
    );
    expect(result.id).toBe('MTG-0001');
    expect(result.title).toBe('Sprint Planning');
    expect(result.status).toBe('open');
  });

  it('creates a meeting with tasks and agents', () => {
    const result = parse<MesaMeeting>(
      handleCreateMeeting(paths, {
        title: 'Feature Review',
        tasks: ['T-0001'],
        agents: ['agent-1', 'agent-2'],
      })
    );
    expect(result.tasks).toEqual(['T-0001']);
    expect(result.agents).toEqual(['agent-1', 'agent-2']);
  });
});

describe('handleListMeetings', () => {
  it('returns empty array when no meetings', () => {
    const result = parse<MesaMeeting[]>(handleListMeetings(paths));
    expect(result).toEqual([]);
  });

  it('lists all meetings', () => {
    handleCreateMeeting(paths, { title: 'Meeting 1' });
    handleCreateMeeting(paths, { title: 'Meeting 2' });
    const result = parse<MesaMeeting[]>(handleListMeetings(paths));
    expect(result).toHaveLength(2);
  });
});

describe('handleRegisterAgent', () => {
  it('registers an agent', () => {
    const result = parse<MesaAgent>(
      handleRegisterAgent(paths, {
        id: 'agent-claude-001',
        name: 'Claude Code',
        client: 'claude-code',
        roles: ['builder', 'planner'],
      })
    );
    expect(result.id).toBe('agent-claude-001');
    expect(result.name).toBe('Claude Code');
    expect(result.client).toBe('claude-code');
    expect(result.roles).toEqual(['builder', 'planner']);
  });
});

describe('handleListAgents', () => {
  it('returns empty array when no agents', () => {
    const result = parse<MesaAgent[]>(handleListAgents(paths));
    expect(result).toEqual([]);
  });

  it('lists all registered agents', () => {
    handleRegisterAgent(paths, {
      id: 'agent-1',
      name: 'Agent 1',
      client: 'client-1',
      roles: ['builder'],
    });
    handleRegisterAgent(paths, {
      id: 'agent-2',
      name: 'Agent 2',
      client: 'client-2',
      roles: ['reviewer'],
    });
    const result = parse<MesaAgent[]>(handleListAgents(paths));
    expect(result).toHaveLength(2);
  });
});
