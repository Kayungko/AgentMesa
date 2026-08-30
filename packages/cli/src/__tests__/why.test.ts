import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  updateTaskStatus,
  appendMessage,
  createMeeting,
  updateMeetingStatus,
  addTaskToMeeting,
  createAgentRun,
  updateAgentRunStatus,
} from '@agentmesa/core';
import type { MesaWorkspacePaths, MesaRuntimeContext } from '@agentmesa/core';
import { runWhy } from '../commands/why.js';
import type { ParsedArgs } from '../parse-args.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-why-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'why',
    subcommand: '',
    positional: [],
    flags: {},
    ...overrides,
  };
}

function captureLog(run: () => void): string {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    run();
    return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    logSpy.mockRestore();
  }
}

describe('CLI why command', () => {
  it('prints usage when no id is given', () => {
    const stdout = captureLog(() => runWhy(makeArgs()));
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('mesa why task <taskId>');
    expect(stdout).toContain('mesa why meeting <meetingId>');
  });

  it('prints usage when task subcommand has no id', () => {
    const stdout = captureLog(() => runWhy(makeArgs({ subcommand: 'task' })));
    expect(stdout).toContain('Usage:');
  });

  it('explains a task in human-readable form (timeline + conclusion)', () => {
    const task = createTask(ctx, { title: 'QR login', reviewer: 'agent-2' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    appendMessage(ctx, {
      meetingId: task.meetingId,
      taskId: task.id,
      type: 'review_request',
      summary: 'Please review',
      to: 'agent-2',
    });
    updateTaskStatus(ctx, task.id, 'ready_for_review');

    const stdout = captureLog(() =>
      runWhy(makeArgs({ subcommand: 'task', positional: [task.id] }), ctx),
    );

    expect(stdout).toContain(`Task Why: ${task.id}`);
    expect(stdout).toContain('Status chain:');
    expect(stdout).toContain('todo -> in_progress');
    expect(stdout).toContain('Timeline:');
    expect(stdout).toContain('task_status_changed');
    expect(stdout).toContain('Conclusion:');
    expect(stdout).toContain('waiting_review');
    expect(stdout).toContain('agent-2');
  });

  it('outputs full structured JSON with --json', () => {
    const task = createTask(ctx, { title: 'JSON task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    const run = createAgentRun(ctx, { taskId: task.id, agentId: 'agent-1', input: 'work' });
    updateAgentRunStatus(ctx, run.id, 'running');

    const stdout = captureLog(() =>
      runWhy(
        makeArgs({ subcommand: 'task', positional: [task.id], flags: { json: true } }),
        ctx,
      ),
    );

    const parsed = JSON.parse(stdout) as {
      entityType: string;
      taskId: string;
      currentStatus: string;
      statusChain: Array<{ from: string | null; to: string; cause: { confidence: string } }>;
      timeline: Array<{ type: string }>;
      blocker: { kind: string; confidence: string };
      relatedRuns: Array<{ runId: string }>;
      relatedArtifacts: unknown[];
      lastActivityAt: string | null;
    };

    expect(parsed.entityType).toBe('task');
    expect(parsed.taskId).toBe(task.id);
    expect(parsed.currentStatus).toBe('in_progress');
    expect(parsed.blocker.kind).toBe('active');
    expect(parsed.blocker.confidence).toBe('evidenced');
    expect(parsed.statusChain).toHaveLength(2);
    expect(parsed.timeline.length).toBeGreaterThanOrEqual(2);
    expect(parsed.relatedRuns).toHaveLength(1);
    expect(parsed.relatedRuns[0]!.runId).toBe(run.id);
    expect(parsed.relatedArtifacts).toEqual([]);
    expect(parsed.lastActivityAt).toBeTruthy();
  });

  it('explains a meeting including its task snapshot', () => {
    const meeting = createMeeting(ctx, { title: 'Sprint review' });
    const task = createTask(ctx, { title: 'Task A', meetingId: meeting.id });
    addTaskToMeeting(ctx, meeting.id, task.id);
    updateTaskStatus(ctx, task.id, 'in_progress');

    const stdout = captureLog(() =>
      runWhy(makeArgs({ subcommand: 'meeting', positional: [meeting.id] }), ctx),
    );

    expect(stdout).toContain(`Meeting Why: ${meeting.id}`);
    expect(stdout).toContain('Tasks:');
    expect(stdout).toContain(task.id);
    expect(stdout).toContain('Conclusion:');
    expect(stdout).toContain('active');
  });

  it('outputs meeting JSON with --json', () => {
    const meeting = createMeeting(ctx, { title: 'Paused sync' });
    updateMeetingStatus(ctx, meeting.id, 'paused');

    const stdout = captureLog(() =>
      runWhy(
        makeArgs({ subcommand: 'meeting', positional: [meeting.id], flags: { json: true } }),
        ctx,
      ),
    );

    const parsed = JSON.parse(stdout) as {
      entityType: string;
      meetingId: string;
      currentStatus: string;
      blocker: { kind: string; waitingOn?: string };
      tasks: unknown[];
    };

    expect(parsed.entityType).toBe('meeting');
    expect(parsed.meetingId).toBe(meeting.id);
    expect(parsed.currentStatus).toBe('paused');
    expect(parsed.blocker.kind).toBe('paused');
    expect(parsed.blocker.waitingOn).toBe('user:local');
    expect(parsed.tasks).toEqual([]);
  });

  it('auto-detects a task id when no subcommand is given', () => {
    const task = createTask(ctx, { title: 'Auto task' });
    updateTaskStatus(ctx, task.id, 'in_progress');

    const stdout = captureLog(() => runWhy(makeArgs({ positional: [task.id] }), ctx));
    expect(stdout).toContain(`Task Why: ${task.id}`);
  });

  it('auto-detects a meeting id when no subcommand is given', () => {
    const meeting = createMeeting(ctx, { title: 'Auto meeting' });

    const stdout = captureLog(() => runWhy(makeArgs({ positional: [meeting.id] }), ctx));
    expect(stdout).toContain(`Meeting Why: ${meeting.id}`);
  });

  it('sets exitCode=1 for an unknown id', () => {
    const prevExitCode = process.exitCode;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
    try {
      runWhy(makeArgs({ positional: ['nonexistent'] }), ctx);
      expect(process.exitCode).toBe(1);
      const stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(stderr).toContain('nonexistent');
    } finally {
      process.exitCode = prevExitCode;
      errorSpy.mockRestore();
    }
  });
});
