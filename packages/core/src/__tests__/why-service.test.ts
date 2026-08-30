import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createTask, updateTaskStatus, assignTask, deleteTask, archiveTask } from '../services/task-service.js';
import { createMeeting, updateMeetingStatus, addTaskToMeeting } from '../services/meeting-service.js';
import { appendMessage } from '../services/message-service.js';
import { createAgentRun, updateAgentRunStatus } from '../services/agent-run-service.js';
import { createCheckResult } from '../services/check-result-service.js';
import { createArtifact } from '../services/artifact-service.js';
import { appendRuntimeEvent } from '../services/runtime-service-utils.js';
import { explainTask, explainMeeting } from '../services/why-service.js';
import { TaskNotFoundError, MeetingNotFoundError } from '../errors.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-why-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Force a task status that the updateTaskStatus state machine cannot reach. */
function forceTaskStatus(taskId: string, status: string): void {
  const filePath = join(paths.tasksDir, `${taskId}.json`);
  const raw = JSON.parse(filePathContent(filePath)) as Record<string, unknown>;
  raw.status = status;
  raw.updatedAt = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
  appendRuntimeEvent(ctx, {
    meetingId: (raw.meetingId as string | undefined) ?? 'workspace',
    type: 'task_status_changed',
    streamId: taskId,
    streamType: 'task',
    data: { oldStatus: 'todo', newStatus: status },
  });
}

function filePathContent(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

describe('explainTask', () => {
  it('reconstructs the status chain with causes from the event log', () => {
    const task = createTask(ctx, { title: 'Chain task' });
    const run = createAgentRun(ctx, { taskId: task.id, agentId: 'agent-1', input: 'do it' });
    updateAgentRunStatus(ctx, run.id, 'running');
    updateAgentRunStatus(ctx, run.id, 'completed', { output: 'done' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const result = explainTask(ctx, task.id);

    expect(result.entityType).toBe('task');
    expect(result.currentStatus).toBe('in_progress');
    expect(result.statusChain).toHaveLength(2);
    expect(result.statusChain[0]!.from).toBeNull();
    expect(result.statusChain[0]!.to).toBe('todo');
    expect(result.statusChain[0]!.cause.confidence).toBe('evidenced');
    expect(result.statusChain[1]!.from).toBe('todo');
    expect(result.statusChain[1]!.to).toBe('in_progress');
    // run events between creation and the transition are the inferred trigger
    expect(result.statusChain[1]!.cause.confidence).toBe('inferred');
    expect(result.statusChain[1]!.cause.triggerEventIds.length).toBeGreaterThanOrEqual(1);
    expect(result.relatedRuns).toHaveLength(1);
    expect(result.relatedRuns[0]!.runId).toBe(run.id);
    expect(result.lastActivityAt).toBeTruthy();
  });

  it('reports unknown cause when no trigger events exist between transitions', () => {
    const task = createTask(ctx, { title: 'Bare task' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const result = explainTask(ctx, task.id);
    const lastStep = result.statusChain.at(-1)!;

    expect(lastStep.cause.confidence).toBe('unknown');
    expect(lastStep.cause.triggerEventIds).toEqual([]);
  });

  it('classifies ready_for_review as waiting_review with reviewer evidence', () => {
    const task = createTask(ctx, { title: 'Review task', assignedTo: 'agent-1', reviewer: 'agent-2' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    appendMessage(ctx, {
      meetingId: task.meetingId,
      taskId: task.id,
      type: 'review_request',
      summary: 'Please review',
      to: 'agent-2',
    });
    updateTaskStatus(ctx, task.id, 'ready_for_review');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('waiting_review');
    expect(result.blocker.confidence).toBe('evidenced');
    expect(result.blocker.waitingOn).toBe('agent-2');
    expect(result.blocker.evidenceEventIds.length).toBeGreaterThanOrEqual(1);
  });

  it('flags a stale ready_for_review when a review_result arrived after entering the status', () => {
    const task = createTask(ctx, { title: 'Stale review', reviewer: 'agent-2' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    updateTaskStatus(ctx, task.id, 'ready_for_review');
    appendMessage(ctx, {
      meetingId: task.meetingId,
      taskId: task.id,
      type: 'review_result',
      summary: 'approved',
      to: 'agent-1',
    });

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('waiting_review');
    expect(result.blocker.confidence).toBe('inferred');
    expect(result.blocker.detail).toContain('stale');
  });

  it('classifies needs_user_decision as waiting_user_decision', () => {
    const task = createTask(ctx, { title: 'Decision task' });
    forceTaskStatus(task.id, 'needs_user_decision');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('waiting_user_decision');
    expect(result.blocker.waitingOn).toBe('user');
    expect(result.blocker.confidence).toBe('evidenced');
    expect(result.blocker.detail).toContain('no decision_made event');
  });

  it('classifies needs_user_decision with a pending workflow as waiting_workflow_approval', () => {
    const task = createTask(ctx, { title: 'Approval task' });
    forceTaskStatus(task.id, 'needs_user_decision');
    appendRuntimeEvent(ctx, {
      meetingId: task.meetingId ?? 'workspace',
      type: 'workflow_waiting_approval',
      streamId: 'wf_123',
      streamType: 'workflow',
      data: {
        workflowId: 'wf_123',
        taskId: task.id,
        status: 'waiting_approval',
        stepId: 'step-2',
        description: 'Deploy to production?',
      },
    });

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('waiting_workflow_approval');
    expect(result.blocker.waitingOn).toBe('user');
    expect(result.blocker.summary).toContain('wf_123');
    expect(result.timeline.some((entry) => entry.type === 'workflow_waiting_approval')).toBe(true);
  });

  it('classifies in_progress without an active run as stalled', () => {
    const task = createTask(ctx, { title: 'Idle task' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('stalled');
    expect(result.blocker.confidence).toBe('inferred');
    expect(result.blocker.summary).toContain('no active agent run');
    expect(result.blocker.lastActivityAt).toBeTruthy();
  });

  it('classifies in_progress with a running run as active', () => {
    const task = createTask(ctx, { title: 'Busy task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    const run = createAgentRun(ctx, { taskId: task.id, agentId: 'agent-1', input: 'work' });
    updateAgentRunStatus(ctx, run.id, 'running');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('active');
    expect(result.blocker.confidence).toBe('evidenced');
    expect(result.blocker.waitingOn).toBe('agent-1');
  });

  it('classifies failed tasks and surfaces the run error summary', () => {
    const task = createTask(ctx, { title: 'Failing task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    const run = createAgentRun(ctx, { taskId: task.id, agentId: 'agent-1', input: 'work' });
    updateAgentRunStatus(ctx, run.id, 'running');
    updateAgentRunStatus(ctx, run.id, 'failed', { error: 'boom: tests exploded' });
    updateTaskStatus(ctx, task.id, 'failed');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('failed');
    expect(result.blocker.confidence).toBe('evidenced');
    expect(result.blocker.errorSummary).toContain('boom: tests exploded');
  });

  it('surfaces a failed check as the error summary when no run failed', () => {
    const task = createTask(ctx, { title: 'Check-fail task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    createCheckResult(ctx, {
      taskId: task.id,
      kind: 'test',
      status: 'failed',
      checkName: 'vitest',
      success: false,
      summary: '2 tests failed',
    });
    updateTaskStatus(ctx, task.id, 'blocked');

    const result = explainTask(ctx, task.id);

    expect(result.blocker.kind).toBe('blocked');
    expect(result.blocker.errorSummary).toContain('vitest');
    expect(result.blocker.errorSummary).toContain('2 tests failed');
  });

  it('classifies terminal and not-started statuses', () => {
    const done = createTask(ctx, { title: 'Done task' });
    updateTaskStatus(ctx, done.id, 'in_progress');
    updateTaskStatus(ctx, done.id, 'cancelled');
    expect(explainTask(ctx, done.id).blocker.kind).toBe('terminal');

    const fresh = createTask(ctx, { title: 'Fresh task', assignedTo: 'agent-1' });
    const freshResult = explainTask(ctx, fresh.id);
    expect(freshResult.blocker.kind).toBe('not_started');
    expect(freshResult.blocker.waitingOn).toBe('agent-1');
  });

  it('explains deleted tasks from the task_deleted event', () => {
    const task = createTask(ctx, { title: 'Doomed task' });
    deleteTask(ctx, task.id);

    const result = explainTask(ctx, task.id);

    expect(result.deleted).toBe(true);
    expect(result.blocker.kind).toBe('deleted');
    expect(result.blocker.confidence).toBe('evidenced');
  });

  it('explains archived tasks', () => {
    const task = createTask(ctx, { title: 'Old task' });
    archiveTask(ctx, task.id);

    const result = explainTask(ctx, task.id);

    expect(result.archived).toBe(true);
    expect(result.blocker.kind).toBe('archived');
  });

  it('includes related artifacts and assignment events in the timeline', () => {
    const task = createTask(ctx, { title: 'Artifact task' });
    assignTask(ctx, task.id, 'agent-9', 'agent-2');
    createArtifact(ctx, { taskId: task.id, kind: 'git_diff', content: 'diff --git' });

    const result = explainTask(ctx, task.id);

    expect(result.relatedArtifacts).toHaveLength(1);
    expect(result.timeline.some((entry) => entry.type === 'task_assigned')).toBe(true);
    expect(result.timeline.some((entry) => entry.type === 'artifact_created')).toBe(true);
  });

  it('throws TaskNotFoundError for an id with neither a file nor events', () => {
    expect(() => explainTask(ctx, 'task_does_not_exist')).toThrow(TaskNotFoundError);
  });

  it('returns a JSON-serializable result', () => {
    const task = createTask(ctx, { title: 'JSON task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    const run = createAgentRun(ctx, { taskId: task.id, agentId: 'agent-1', input: 'x' });

    const result = explainTask(ctx, task.id);
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
    expect(run.id).toMatch(/^run_/);
  });
});

describe('explainMeeting', () => {
  it('reconstructs meeting status and reports active for an open meeting', () => {
    const meeting = createMeeting(ctx, { title: 'Sprint' });
    const task = createTask(ctx, { title: 'Task A', meetingId: meeting.id });
    addTaskToMeeting(ctx, meeting.id, task.id);
    updateTaskStatus(ctx, task.id, 'in_progress');

    const result = explainMeeting(ctx, meeting.id);

    expect(result.entityType).toBe('meeting');
    expect(result.currentStatus).toBe('open');
    expect(result.blocker.kind).toBe('active');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.status).toBe('in_progress');
    // meeting stream + task stream are merged into one timeline
    expect(result.timeline.some((entry) => entry.type === 'meeting_created')).toBe(true);
    expect(result.timeline.some((entry) => entry.type === 'task_created')).toBe(true);
  });

  it('reports paused meetings with the actor who paused', () => {
    const meeting = createMeeting(ctx, { title: 'Paused' });
    updateMeetingStatus(ctx, meeting.id, 'paused');

    const result = explainMeeting(ctx, meeting.id);

    expect(result.blocker.kind).toBe('paused');
    expect(result.blocker.waitingOn).toBe('user:test');
    expect(result.statusChain).toHaveLength(2);
    expect(result.statusChain[1]!.to).toBe('paused');
  });

  it('reports terminal meetings as immutable', () => {
    const meeting = createMeeting(ctx, { title: 'Closed' });
    updateMeetingStatus(ctx, meeting.id, 'closed');

    const result = explainMeeting(ctx, meeting.id);

    expect(result.blocker.kind).toBe('terminal');
    expect(result.blocker.summary).toContain('terminal');
  });

  it('throws MeetingNotFoundError for an unknown meeting', () => {
    expect(() => explainMeeting(ctx, 'meeting_does_not_exist')).toThrow(MeetingNotFoundError);
  });
});
