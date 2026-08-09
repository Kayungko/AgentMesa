import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  RoleBasedPolicyEngine,
  createCheckResult,
  listArtifacts,
} from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { runTimeline } from '../commands/events.js';
import { runPolicyCheck, runPolicyInspect } from '../commands/policy.js';
import { runTransports } from '../commands/transports.js';
import { runDoctor } from '../commands/doctor.js';
import { runChecks } from '../commands/checks.js';
import { runGithub } from '../commands/github.js';
import { runPlugin } from '../commands/plugin.js';
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

  describe('policy inspect role-based matrix', () => {
    it('includes read_only role and run/handoff/check actions', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        const args = makeArgs({ subcommand: 'inspect', flags: { json: true } });
        runPolicyInspect(args);

        const line = logSpy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('"roles"'));
        expect(line).toBeDefined();
        const parsed = JSON.parse(line as string) as {
          roles: string[];
          actions: Array<Record<string, unknown>>;
        };
        expect(parsed.roles).toContain('read_only');

        const handoffRead = parsed.actions.find((a) => a.action === 'handoff.read');
        expect(handoffRead).toBeDefined();
        expect(handoffRead?.['read_only']).toBe(true);
        expect(handoffRead?.['custom']).toBe(false);

        const runCreate = parsed.actions.find((a) => a.action === 'run.create');
        expect(runCreate).toBeDefined();
        expect(runCreate?.['builder']).toBe(true);
      } finally {
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

  describe('transports inbox/outbox invalid status', () => {
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

    it('invalid --status for inbox sets exitCode=1', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
          flags: { status: 'bad' },
        });
        runTransports(args);
        expect(process.exitCode).toBe(1);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).not.toContain('Inbound');
        expect(stdout).not.toContain('envelopes');
        process.cwd = origCwd;
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('invalid --status for outbox with --json outputs structured error', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'outbox',
          positional: ['File Transport'],
          flags: { status: 'bad', json: true },
        });
        runTransports(args);
        expect(process.exitCode).toBe(1);
        let foundError = false;
        for (const call of logSpy.mock.calls) {
          const line = call.join(' ');
          if (line.startsWith('{') && line.includes('"error"')) {
            const parsed = JSON.parse(line) as { error: string; code: string };
            expect(parsed.error).toContain('Invalid --status');
            foundError = true;
          }
          if (line.startsWith('{') && line.includes('"envelopes"')) {
            expect.fail(`stdout should not contain envelope data on bad status: ${line}`);
          }
        }
        expect(foundError).toBe(true);
        process.cwd = origCwd;
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('valid --status values pass through correctly', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => testDir;
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
          flags: { status: 'processed' },
        });
        runTransports(args);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Inbound');
        process.cwd = origCwd;
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('transports inbox/outbox policy gate', () => {
    function makeCtx(role: 'owner' | 'builder') {
      return createRuntimeContext({
        rootDir: testDir,
        actor: { id: 'user:test', type: 'user', roles: [role] },
        policy: new RoleBasedPolicyEngine(),
      });
    }

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
      paths = initWorkspace(testDir);
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('builder cannot inspect inbox', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const ctx = makeCtx('builder');
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
        });
        runTransports(args, ctx);
        expect(process.exitCode).toBe(1);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).not.toContain('Inbound');
        expect(stdout).not.toContain('envelopes');
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('builder cannot inspect outbox', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const ctx = makeCtx('builder');
        const args = makeArgs({
          subcommand: 'outbox',
          positional: ['File Transport'],
        });
        runTransports(args, ctx);
        expect(process.exitCode).toBe(1);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).not.toContain('Outbound');
        expect(stdout).not.toContain('envelopes');
      } finally {
        process.exitCode = prevExitCode;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('owner can inspect inbox', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const ctx = makeCtx('owner');
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
        });
        runTransports(args, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Inbound');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('owner can inspect outbox', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const ctx = makeCtx('owner');
        const args = makeArgs({
          subcommand: 'outbox',
          positional: ['File Transport'],
        });
        runTransports(args, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Outbound');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('denied inbox with --json outputs structured error', () => {
      const prevExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;
      try {
        const ctx = makeCtx('builder');
        const args = makeArgs({
          subcommand: 'inbox',
          positional: ['File Transport'],
          flags: { json: true },
        });
        runTransports(args, ctx);
        expect(process.exitCode).toBe(1);
        let foundError = false;
        for (const call of logSpy.mock.calls) {
          const line = call.join(' ');
          if (line.startsWith('{') && line.includes('"error"')) {
            const parsed = JSON.parse(line) as { error: string; code: string };
            expect(parsed.code).toBe('POLICY_DENIED');
            expect(parsed.error).toContain('transport.inspect');
            foundError = true;
          }
          if (line.startsWith('{') && line.includes('"envelopes"')) {
            expect.fail(`stdout should not contain envelope data on denied: ${line}`);
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

  describe('doctor --json transport findings', () => {
    let doctorDir: string;
    beforeEach(() => {
      doctorDir = mkdtempSync(join(tmpdir(), 'agentmesa-doctor-'));
      initWorkspace(doctorDir);
    });
    afterEach(() => {
      rmSync(doctorDir, { recursive: true, force: true });
    });
    it('corrupted transport envelope includes category "transport" in --json', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const inboxDir = join(doctorDir, '.agentmesa', 'inbox');
        writeFileSync(join(inboxDir, 'bad.json'), 'not-valid-json{{{');
        const origCwd = process.cwd;
        process.cwd = () => doctorDir;
        runDoctor({ command: 'doctor', subcommand: '', positional: [], flags: { json: true } });
        process.cwd = origCwd;
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as { findings: Array<Record<string, unknown>> };
        const transportErrors = parsed.findings.filter((f) => f.category === 'transport' && f.level === 'error');
        expect(transportErrors.length).toBeGreaterThanOrEqual(1);
        expect(transportErrors[0]!.category).toBe('transport');
        expect(transportErrors[0]!.level).toBe('error');
        expect(transportErrors[0]!.recommendation).toBeTruthy();
      } finally {
        logSpy.mockRestore();
      }
    });
    it('doctor --json ok findings have category', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const origCwd = process.cwd;
        process.cwd = () => doctorDir;
        runDoctor({ command: 'doctor', subcommand: '', positional: [], flags: { json: true } });
        process.cwd = origCwd;
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as { findings: Array<Record<string, unknown>> };
        const generalFindings = parsed.findings.filter((f) => f.category === 'general');
        expect(generalFindings.length).toBeGreaterThan(0);
        const transportOk = parsed.findings.filter((f) => f.category === 'transport' && f.level === 'ok');
        expect(transportOk.length).toBeGreaterThanOrEqual(1);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('CLI checks commands', () => {
  describe('checks list', () => {
    it('lists check results filtered by task/kind/status as JSON', () => {
      const task = createTask(ctx, { title: 'Checked feature' });
      createCheckResult(ctx, { taskId: task.id, kind: 'test', status: 'passed', checkName: 'Unit', success: true });
      createCheckResult(ctx, { taskId: task.id, kind: 'lint', status: 'failed', checkName: 'ESLint', success: false });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        runChecks({ command: 'checks', subcommand: 'list', positional: [], flags: { json: true, task: task.id } }, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as Array<{ checkName: string }>;
        expect(parsed).toHaveLength(2);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('filters by status', () => {
      const task = createTask(ctx, { title: 'Checked feature' });
      createCheckResult(ctx, { taskId: task.id, status: 'passed', checkName: 'Unit', success: true });
      createCheckResult(ctx, { taskId: task.id, status: 'failed', checkName: 'ESLint', success: false });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        runChecks({ command: 'checks', subcommand: 'list', positional: [], flags: { json: true, status: 'failed' } }, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as Array<{ checkName: string; status: string }>;
        expect(parsed).toHaveLength(1);
        expect(parsed[0]!.checkName).toBe('ESLint');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('checks show', () => {
    it('shows a check result by id as JSON', () => {
      const task = createTask(ctx, { title: 'Checked feature' });
      const check = createCheckResult(ctx, { taskId: task.id, status: 'passed', checkName: 'Unit', success: true });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        runChecks({ command: 'checks', subcommand: 'show', positional: [check.id], flags: { json: true } }, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const parsed = JSON.parse(stdout) as { id: string };
        expect(parsed.id).toBe(check.id);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('prints usage when checkId is missing', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        runChecks({ command: 'checks', subcommand: 'show', positional: [], flags: {} }, ctx);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Usage: mesa checks show');
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('CLI github commands', () => {
  describe('github link-pr', () => {
    it('links a PR to a task by creating a pr_summary artifact', async () => {
      const task = createTask(ctx, { title: 'PR-linked feature' });
      await runGithub(
        { command: 'github', subcommand: 'link-pr', positional: [task.id, '42'], flags: { json: true } },
        paths,
      );
      const artifacts = listArtifacts(ctx, task.id, 'pr_summary');
      expect(artifacts).toHaveLength(1);
    });

    it('prints usage when arguments are missing', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runGithub({ command: 'github', subcommand: 'link-pr', positional: [], flags: {} }, paths);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Usage: mesa github link-pr');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('github import-ci', () => {
    it('prints usage when taskId is missing (does not shell out to gh)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runGithub({ command: 'github', subcommand: 'import-ci', positional: [], flags: {} }, paths);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('Usage: mesa github import-ci');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('github unknown subcommand', () => {
    it('prints usage listing link-pr and import-ci', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runGithub({ command: 'github', subcommand: '', positional: [], flags: {} }, paths);
        const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(stdout).toContain('link-pr');
        expect(stdout).toContain('import-ci');
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('CLI plugin commands', () => {
  function withCwd(dir: string, run: () => void): void {
    const origCwd = process.cwd;
    process.cwd = () => dir;
    try {
      run();
    } finally {
      process.cwd = origCwd;
    }
  }

  it('rejects an unknown side for install/uninstall/runner', () => {
    const prevExitCode = process.exitCode;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = 0;
    try {
      for (const subcommand of ['install', 'uninstall', 'runner']) {
        process.exitCode = 0;
        runPlugin({ command: 'plugin', subcommand, positional: ['cursor'], flags: {} });
        expect(process.exitCode).toBe(1);
      }
      const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(stdout).toContain('<claude|codex>');
    } finally {
      process.exitCode = prevExitCode;
      logSpy.mockRestore();
    }
  });

  it('stores and clears runner commands in config.json', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      withCwd(testDir, () => {
        runPlugin({ command: 'plugin', subcommand: 'runner', positional: ['codex', 'codex exec -'], flags: {} });
      });
      const config = JSON.parse(readFileSync(join(testDir, '.agentmesa', 'config.json'), 'utf-8'));
      expect(config.runners).toEqual({ codexCmd: 'codex exec -' });
      expect(config.policy).toEqual({ mode: 'role-based' });

      withCwd(testDir, () => {
        runPlugin({ command: 'plugin', subcommand: 'runner', positional: ['codex'], flags: { clear: true } });
      });
      const cleared = JSON.parse(readFileSync(join(testDir, '.agentmesa', 'config.json'), 'utf-8'));
      expect(cleared.runners).toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('runner without a command or --clear prints usage', () => {
    const prevExitCode = process.exitCode;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = 0;
    try {
      withCwd(testDir, () => {
        runPlugin({ command: 'plugin', subcommand: 'runner', positional: ['claude'], flags: {} });
      });
      expect(process.exitCode).toBe(1);
      const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(stdout).toContain('Usage: mesa plugin runner');
    } finally {
      process.exitCode = prevExitCode;
      logSpy.mockRestore();
    }
  });

  it('status --json returns the documented shape', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      withCwd(testDir, () => {
        runPlugin({ command: 'plugin', subcommand: 'status', positional: [], flags: { json: true } });
      });
      const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(stdout) as {
        claude: { cliAvailable: boolean; mcpInstalled: boolean };
        codex: { cliAvailable: boolean; mcpInstalled: boolean };
        runners: Record<string, unknown>;
        runnerSources: { claude: string; codex: string };
      };
      expect(typeof parsed.claude.cliAvailable).toBe('boolean');
      expect(typeof parsed.codex.mcpInstalled).toBe('boolean');
      expect(['env', 'config', 'stub']).toContain(parsed.runnerSources.claude);
      expect(['env', 'config', 'stub']).toContain(parsed.runnerSources.codex);
    } finally {
      logSpy.mockRestore();
    }
  });
});
