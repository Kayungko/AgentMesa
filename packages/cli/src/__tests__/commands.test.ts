import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  createMeeting,
  listMeetings,
  registerAgent,
  listAgents,
  rebuildAllProjections,
} from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { runTimeline } from '../commands/events.js';
import { runPolicyCheck, runPolicyInspect } from '../commands/policy.js';
import { runTransports } from '../commands/transports.js';
import type { ParsedArgs } from '../parse-args.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('CLI integration: task workflow', () => {
  it('creates and lists tasks', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    expect(task.id).toMatch(/^task_/);

    const tasks = listTasks(ctx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Build feature');
  });

  it('updates task status through lifecycle', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = updateTaskStatus(ctx, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');

    const fetched = getTask(ctx, task.id);
    expect(fetched.status).toBe('in_progress');
  });

  it('registers and lists agents', () => {
    registerAgent(ctx, { id: 'claude', name: 'Claude Code', client: 'claude-code', status: 'available', roles: ['builder'] });
    registerAgent(ctx, { id: 'codex', name: 'Codex', client: 'codex', status: 'available', roles: ['reviewer'] });

    const agents = listAgents(ctx);
    expect(agents).toHaveLength(2);
  });

  it('creates meetings', () => {
    const meeting = createMeeting(ctx, { title: 'Feature Review' });
    expect(meeting.id).toMatch(/^meeting_/);
    expect(meeting.status).toBe('open');

    const meetings = listMeetings(ctx);
    expect(meetings).toHaveLength(1);
  });
});

describe('CLI integration: workspace init', () => {
  it('workspace directories exist after init', () => {
    expect(existsSync(paths.mesaDir)).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.meetingsDir)).toBe(true);
    expect(existsSync(join(paths.mesaDir, 'config.json'))).toBe(true);
  });

  it('config.json has correct protocol version', () => {
    const config = JSON.parse(readFileSync(join(paths.mesaDir, 'config.json'), 'utf-8'));
    expect(config.protocolVersion).toBe('0.2.0');
  });
});

describe('CLI integration: timeline subcommands', () => {
  it('task timeline has task events and projection', async () => {
    const task = createTask(ctx, { title: 'Timeline task' });
    updateTaskStatus(ctx, task.id, 'in_progress');
    rebuildAllProjections(ctx);

    const { getTaskEvents, getTaskProjection } = await import('@agentmesa/core');
    const events = getTaskEvents(ctx, task.id);
    const proj = getTaskProjection(ctx, task.id);

    expect(events.length).toBeGreaterThanOrEqual(2); // task_created + task_status_changed
    expect(events[0]!.type).toBe('task_created');
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(task.id);
    expect(proj!.status).toBe('in_progress');
  });

  it('meeting timeline has meeting events and projection', async () => {
    const meeting = createMeeting(ctx, { title: 'Timeline meeting' });
    rebuildAllProjections(ctx);

    const { getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');
    const events = getMeetingEvents(ctx, meeting.id);
    const proj = getMeetingProjection(ctx, meeting.id);

    expect(events.length).toBeGreaterThanOrEqual(1); // meeting_created
    expect(events[0]!.type).toBe('meeting_created');
    expect(proj).not.toBeNull();
    expect(proj!.id).toBe(meeting.id);
    expect(proj!.title).toBe('Timeline meeting');
  });

  it('unknown task id returns empty events and null projection', async () => {
    const { getTaskEvents, getTaskProjection } = await import('@agentmesa/core');
    const events = getTaskEvents(ctx, 'nonexistent');
    const proj = getTaskProjection(ctx, 'nonexistent');

    expect(events).toEqual([]);
    expect(proj).toBeNull();
  });

  it('unknown meeting id returns empty events and null projection', async () => {
    const { getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');
    const events = getMeetingEvents(ctx, 'nonexistent');
    const proj = getMeetingProjection(ctx, 'nonexistent');

    expect(events).toEqual([]);
    expect(proj).toBeNull();
  });

  it('auto-detect task when no subcommand given', async () => {
    const task = createTask(ctx, { title: 'Auto task' });
    rebuildAllProjections(ctx);

    const { listEvents, getTaskProjection, getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');

    // Simulate auto-detection logic: filter by streamId + streamType='task'
    const taskEvents = listEvents(ctx, { streamId: task.id, streamType: 'task' });
    const taskProj = getTaskProjection(ctx, task.id);

    if (taskEvents.length > 0 || taskProj) {
      expect(taskEvents.length).toBeGreaterThanOrEqual(1);
      expect(taskEvents[0]!.type).toBe('task_created');
      expect(taskProj!.id).toBe(task.id);
      return; // task detected
    }

    const meetingEvents = getMeetingEvents(ctx, task.id);
    const meetingProj = getMeetingProjection(ctx, task.id);
    // Should not reach here for a task id
    expect(meetingEvents.length > 0 || meetingProj).toBe(false);
  });

  it('auto-detect meeting when no subcommand given', async () => {
    const meeting = createMeeting(ctx, { title: 'Auto meeting' });
    rebuildAllProjections(ctx);

    const { listEvents, getTaskProjection, getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');

    const taskEvents = listEvents(ctx, { streamId: meeting.id, streamType: 'task' });
    const taskProj = getTaskProjection(ctx, meeting.id);
    // Task lookup should fail for a meeting id (streamType filter excludes meeting events)
    expect(taskEvents.length === 0 && !taskProj).toBe(true);

    // Fall through to meeting
    const meetingEvents = getMeetingEvents(ctx, meeting.id);
    const meetingProj = getMeetingProjection(ctx, meeting.id);
    expect(meetingEvents.length).toBeGreaterThanOrEqual(1);
    expect(meetingEvents[0]!.type).toBe('meeting_created');
    expect(meetingProj!.id).toBe(meeting.id);
  });

  it('auto-detect unknown id returns nothing', async () => {
    const { listEvents, getTaskProjection, getMeetingEvents, getMeetingProjection } = await import('@agentmesa/core');

    const taskEvents = listEvents(ctx, { streamId: 'nonexistent', streamType: 'task' });
    const taskProj = getTaskProjection(ctx, 'nonexistent');
    const meetingEvents = getMeetingEvents(ctx, 'nonexistent');
    const meetingProj = getMeetingProjection(ctx, 'nonexistent');

    expect(taskEvents).toEqual([]);
    expect(taskProj).toBeNull();
    expect(meetingEvents).toEqual([]);
    expect(meetingProj).toBeNull();
  });
});

describe('CLI policy commands', () => {
  function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
      command: 'policy',
      subcommand: 'check',
      positional: [],
      flags: {},
      ...overrides,
    };
  }

  describe('policy check --mode invalid', () => {
    it('sets exitCode=1 and does not output allowed decision', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;

      try {
        const args = makeArgs({
          positional: ['task.delete', 'task:1'],
          flags: { mode: 'invalid', actor: 'test', role: 'builder' },
        });
        runPolicyCheck(args);

        expect(process.exitCode).toBe(1);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).not.toContain('ALLOWED');
        expect(stdout).not.toContain('DENIED');
        expect(stdout).not.toContain('allowed');
        const stderr = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stderr).toContain('Invalid --mode');
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('invalid mode with --json outputs structured error', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;

      try {
        const args = makeArgs({
          positional: ['task.delete', 'task:1'],
          flags: { mode: 'invalid', json: true, actor: 'test', role: 'builder' },
        });
        runPolicyCheck(args);

        expect(process.exitCode).toBe(1);

        // Find the JSON error object on stdout
        let foundError = false;
        for (const call of logSpy.mock.calls) {
          const line = call.join(' ');
          if (line.startsWith('{') && line.includes('"error"')) {
            const parsed = JSON.parse(line) as { error: string; code: string };
            expect(parsed.error).toContain('Invalid --mode');
            expect(parsed.code).toBe('ERROR');
            foundError = true;
          }
          if (line.startsWith('{') && line.includes('"allowed"')) {
            expect.fail(`stdout should not contain allowed decision: ${line}`);
          }
        }
        expect(foundError).toBe(true);
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe('policy inspect --mode invalid', () => {
    it('sets exitCode=1 and does not output matrix', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;

      try {
        const args = makeArgs({
          subcommand: 'inspect',
          flags: { mode: 'invalid' },
        });
        runPolicyInspect(args);

        expect(process.exitCode).toBe(1);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).not.toContain('Policy mode');
        const stderr = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stderr).toContain('Invalid --mode');
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('invalid mode with --json outputs structured error', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;

      try {
        const args = makeArgs({
          subcommand: 'inspect',
          flags: { mode: 'invalid', json: true },
        });
        runPolicyInspect(args);

        expect(process.exitCode).toBe(1);

        // Find the JSON error object on stdout
        let foundError = false;
        for (const call of logSpy.mock.calls) {
          const line = call.join(' ');
          if (line.startsWith('{') && line.includes('"error"')) {
            const parsed = JSON.parse(line) as { error: string; code: string };
            expect(parsed.error).toContain('Invalid --mode');
            expect(parsed.code).toBe('ERROR');
            foundError = true;
          }
          if (line.startsWith('{') && line.includes('"actions"')) {
            expect.fail(`stdout should not contain matrix: ${line}`);
          }
        }
        expect(foundError).toBe(true);
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });
});

describe('CLI transports subcommands', () => {
  function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
      command: 'transports',
      subcommand: 'list',
      positional: [],
      flags: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    // Ensure we're in an initialized workspace for transport commands
    testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
    paths = initWorkspace(testDir);
    ctx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('transports list', () => {
    it('outputs transport table', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs();
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('File Transport');
        expect(stdout).toContain('file');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });

    it('outputs JSON when --json flag set', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({ flags: { json: true } });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(() => JSON.parse(stdout)).not.toThrow();
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('transports inspect', () => {
    it('outputs transport details', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inspect',
          positional: ['File Transport'],
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('File Transport');
        expect(stdout).toContain('file');
        expect(stdout).toContain('0.2.0');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });

    it('outputs JSON when --json flag set', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inspect',
          positional: ['File Transport'],
          flags: { json: true },
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.name).toBe('File Transport');
        expect(parsed.type).toBe('file');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });

    it('throws error without name argument', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({ subcommand: 'inspect' });
        runTransports(args);
        expect(process.exitCode).toBe(1);
        process.cwd = origCwd;
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
      }
    });
  });

  describe('transports inbox', () => {
    it('shows inbox (empty) for File Transport', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Inbound');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });

    it('outputs JSON inbox', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
          flags: { json: true },
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.transport).toBe('File Transport');
        expect(Array.isArray(parsed.envelopes)).toBe(true);
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('transports outbox', () => {
    it('shows outbox (empty) for File Transport', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'outbox',
          positional: ['File Transport'],
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Outbound');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });

    it('outputs JSON outbox', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'outbox',
          positional: ['File Transport'],
          flags: { json: true },
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.transport).toBe('File Transport');
        expect(Array.isArray(parsed.envelopes)).toBe(true);
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('transports unknown subcommand', () => {
    it('sets exitCode=1 for unknown subcommand', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({ subcommand: 'foobar' });
        runTransports(args);
        expect(process.exitCode).toBe(1);
        process.cwd = origCwd;
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
      }
    });
  });

  describe('transports inbox for unsupported transport', () => {
    it('throws error for transport without inbox support', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        // MCPTransport does not support inbox
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['MCP Transport'],
        });
        runTransports(args);
        expect(process.exitCode).toBe(1);
        process.cwd = origCwd;
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
      }
    });
  });
});
