import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  registerAgent,
  createTask,
  createMeeting,
  createAgentRun,
  getAgentRun,
  listArtifacts,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeDriverTurn, executeRun } from '../run-executor.js';
import { attachPermissionResponder } from '../drivers/permission-bridge.js';
import type {
  AgentDriver,
  AgentDriverSession,
  DriverEvent,
  DriverKind,
  DriverSessionHandle,
  DriverSessionInit,
  DriverTurnInput,
} from '../drivers/types.js';

let testDir: string;
let ctx: MesaRuntimeContext;
const prevClaudeCmd = process.env.AGENTMESA_CLAUDE_CMD;
const prevDriverEnv = process.env.AGENTMESA_DRIVER;

let sessionCounter = 0;

type EventFactory = (session: FakeDriverSession, prompt: string) => DriverEvent[];

class FakeDriverSession implements AgentDriverSession {
  readonly kind: DriverKind;
  readonly backendSessionId: string;
  readonly createdAt: string;
  resumed = false;
  closed = false;
  interrupted = false;
  permissionCalls: Array<{ requestId: string; decision: 'allow' | 'deny'; message?: string }> = [];
  receivedPrompts: string[] = [];

  constructor(
    kind: DriverKind,
    backendSessionId: string,
    protected events: EventFactory,
  ) {
    this.kind = kind;
    this.backendSessionId = backendSessionId;
    this.createdAt = new Date().toISOString();
  }

  async *send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent> {
    this.receivedPrompts.push(input.prompt);
    yield* this.events(this, input.prompt);
  }

  async respondPermission(
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string,
  ): Promise<void> {
    this.permissionCalls.push({
      requestId,
      decision,
      ...(message !== undefined ? { message } : {}),
    });
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  handle(): DriverSessionHandle {
    return { kind: this.kind, backendSessionId: this.backendSessionId, createdAt: this.createdAt };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A session that stalls forever after its first event (timeout testing). */
class HangingDriverSession extends FakeDriverSession {
  async *send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent> {
    this.receivedPrompts.push(input.prompt);
    yield { type: 'text', text: 'working' };
    await new Promise<never>(() => {});
  }
}

class FakeAgentDriver implements AgentDriver {
  readonly kind: DriverKind;
  readonly name: string;
  available = true;
  resumeError: Error | undefined;
  createdSessions: FakeDriverSession[] = [];
  resumedHandles: DriverSessionHandle[] = [];
  private events: EventFactory;

  constructor(
    kind: DriverKind,
    events: EventFactory,
    private sessionFactory?: (backendSessionId: string) => FakeDriverSession,
  ) {
    this.kind = kind;
    this.name = kind;
    this.events = events;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async createSession(_init: DriverSessionInit): Promise<AgentDriverSession> {
    const id = `sess-${++sessionCounter}`;
    const session = this.sessionFactory
      ? this.sessionFactory(id)
      : new FakeDriverSession(this.kind, id, this.events);
    this.createdSessions.push(session);
    return session;
  }

  async resumeSession(
    handle: DriverSessionHandle,
    _init: DriverSessionInit,
  ): Promise<AgentDriverSession> {
    if (this.resumeError) {
      throw this.resumeError;
    }
    const session = this.sessionFactory
      ? this.sessionFactory(handle.backendSessionId)
      : new FakeDriverSession(this.kind, handle.backendSessionId, this.events);
    session.resumed = true;
    this.resumedHandles.push(handle);
    return session;
  }
}

const DEFAULT_EVENTS: EventFactory = () => [
  { type: 'text', text: 'Working on it.' },
  { type: 'thinking', text: 'Considering the approach' },
  { type: 'tool_use', tool: 'bash', input: { command: 'ls -la' } },
  {
    type: 'permission_request',
    request: { requestId: 'perm-1', kind: 'tool', title: 'bash: rm -rf build/', detail: {} },
  },
  { type: 'text', text: 'Done: implemented the feature.' },
  { type: 'turn_complete', success: true, summary: 'Implemented the feature' },
];

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-driver-exec-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
  registerAgent(ctx, {
    id: 'agent:claude',
    name: 'Claude',
    client: 'claude-code',
    roles: ['builder'],
    status: 'available',
  });
  delete process.env.AGENTMESA_CLAUDE_CMD;
  delete process.env.AGENTMESA_DRIVER;
});

afterEach(() => {
  if (prevClaudeCmd === undefined) {
    delete process.env.AGENTMESA_CLAUDE_CMD;
  } else {
    process.env.AGENTMESA_CLAUDE_CMD = prevClaudeCmd;
  }
  if (prevDriverEnv === undefined) {
    delete process.env.AGENTMESA_DRIVER;
  } else {
    process.env.AGENTMESA_DRIVER = prevDriverEnv;
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe('executeRun deep-driver path', () => {
  it('executes a run as a driver turn when auto resolves to an available driver', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'Implement login' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build the login form',
      taskId: task.id,
      action: 'implement',
    });

    const progress: string[] = [];
    const { run: final, result } = await executeRun(ctx, run.id, {
      driverRegistry: [driver],
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(final.status).toBe('completed');
    expect(final.output).toContain('Done: implemented the feature.');
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);

    expect(driver.createdSessions).toHaveLength(1);
    expect(driver.createdSessions[0]!.receivedPrompts).toEqual(['Build the login form']);
    expect(driver.createdSessions[0]!.closed).toBe(true);

    // DriverEvent → RunProgress mapping.
    expect(progress).toEqual([
      'started',
      'driver_session',
      'agent_message',
      'agent_thinking',
      'tool_use',
      'permission_request',
      'permission_denied',
      'agent_message',
      'persisting_artifact',
      'completed',
    ]);

    // Successful non-dry driver turns persist the agent_run_log artifact.
    const artifacts = listArtifacts(ctx, undefined, 'agent_run_log');
    expect(artifacts).toHaveLength(1);
    expect(final.producedArtifactIds).toEqual([artifacts[0]!.id]);
  });

  it('denies permission requests by default', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Do it',
      taskId: task.id,
      action: 'implement',
    });

    await executeRun(ctx, run.id, { driverRegistry: [driver] });

    const session = driver.createdSessions[0]!;
    expect(session.permissionCalls).toEqual([
      { requestId: 'perm-1', decision: 'deny', message: 'Denied by AgentMesa policy' },
    ]);
  });

  it('routes permission requests through the injected responder', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Do it',
      taskId: task.id,
      action: 'implement',
    });

    const progress: string[] = [];
    await executeRun(ctx, run.id, {
      driverRegistry: [driver],
      permissionResponder: async (request) => {
        expect(request.requestId).toBe('perm-1');
        return 'allow';
      },
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(driver.createdSessions[0]!.permissionCalls).toEqual([{ requestId: 'perm-1', decision: 'allow' }]);
    expect(progress).toContain('permission_granted');
    expect(progress).not.toContain('permission_denied');
  });

  it('persists the session handle and resumes it for the next run in the same meeting', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const meeting = createMeeting(ctx, { title: 'Driver 会话' });
    const run1 = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'First turn',
      action: 'custom',
      runnerType: 'session',
    });
    const { run: final1 } = await executeRun(ctx, run1.id, { driverRegistry: [driver] });
    expect(final1.status).toBe('completed');

    // Handle persisted under .agentmesa/driver-sessions/.
    expect(existsSync(join(testDir, '.agentmesa', 'driver-sessions', 'agent_claude.json'))).toBe(true);

    const run2 = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'Second turn',
      action: 'custom',
      runnerType: 'session',
    });
    const { run: final2 } = await executeRun(ctx, run2.id, { driverRegistry: [driver] });
    expect(final2.status).toBe('completed');

    expect(driver.createdSessions).toHaveLength(1);
    expect(driver.resumedHandles).toHaveLength(1);
    expect(driver.resumedHandles[0]!.backendSessionId).toBe(driver.createdSessions[0]!.backendSessionId);
    expect(driver.resumedHandles[0]!.kind).toBe('claude-agent-sdk');
  });

  it('keeps separate sessions for different meeting scopes', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const meetingA = createMeeting(ctx, { title: 'A' });
    const meetingB = createMeeting(ctx, { title: 'B' });

    for (const meeting of [meetingA, meetingB]) {
      const run = createAgentRun(ctx, {
        agentId: 'agent:claude',
        meetingId: meeting.id,
        input: 'turn',
        action: 'custom',
        runnerType: 'session',
      });
      const { run: final } = await executeRun(ctx, run.id, { driverRegistry: [driver] });
      expect(final.status).toBe('completed');
    }

    expect(driver.createdSessions).toHaveLength(2);
    expect(driver.resumedHandles).toHaveLength(0);
  });

  it('creates a fresh session when resume fails', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const meeting = createMeeting(ctx, { title: 'Broken resume' });
    const run1 = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'First turn',
      action: 'custom',
      runnerType: 'session',
    });
    await executeRun(ctx, run1.id, { driverRegistry: [driver] });

    driver.resumeError = new Error('backend session gone');
    const run2 = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'Second turn',
      action: 'custom',
      runnerType: 'session',
    });
    const { run: final2 } = await executeRun(ctx, run2.id, { driverRegistry: [driver] });

    expect(final2.status).toBe('completed');
    expect(driver.createdSessions).toHaveLength(2);
  });

  it('marks the run failed when the turn completes unsuccessfully', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', () => [
      { type: 'text', text: 'I could not finish.' },
      { type: 'turn_complete', success: false, summary: 'Build failed: missing dependency' },
    ]);
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Do it',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final, result } = await executeRun(ctx, run.id, { driverRegistry: [driver] });

    expect(final.status).toBe('failed');
    expect(final.error).toContain('Build failed: missing dependency');
    expect(result.success).toBe(false);
  });

  it('marks the run failed on a fatal driver error', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', () => [
      { type: 'error', message: 'backend crashed', fatal: true },
    ]);
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Do it',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, { driverRegistry: [driver] });
    expect(final.status).toBe('failed');
    expect(final.error).toContain('backend crashed');
  });

  it('interrupts the driver session and fails the run on timeout', async () => {
    const driver = new FakeAgentDriver(
      'claude-agent-sdk',
      DEFAULT_EVENTS,
      () => new HangingDriverSession('claude-agent-sdk', 'sess-hang', DEFAULT_EVENTS),
    );
    const task = createTask(ctx, { title: 'T' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Hang forever',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, {
      driverRegistry: [driver],
      timeout: 50,
    });

    expect(final.status).toBe('failed');
    expect(final.error).toContain('timeout');
    expect(driver.createdSessions[0]!.interrupted).toBe(true);
    expect(driver.createdSessions[0]!.closed).toBe(true);
  });
});

describe('executeRun CLI fallback / zero regression', () => {
  it('falls back to the CLI runner when the driver is unavailable', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    driver.available = false;
    const task = createTask(ctx, { title: 'CLI fallback' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build it',
      taskId: task.id,
      action: 'implement',
    });

    const progress: string[] = [];
    const { run: final } = await executeRun(ctx, run.id, {
      driverRegistry: [driver],
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(driver.createdSessions).toHaveLength(0);
    expect(final.status).toBe('completed');
    expect(progress).toEqual(['started', 'runner_invoked', 'persisting_artifact', 'completed']);
  });

  it('keeps the CLI path when preference is cli even with an available driver', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'Pinned CLI' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build it',
      taskId: task.id,
      action: 'implement',
    });

    const progress: string[] = [];
    const { run: final } = await executeRun(ctx, run.id, {
      driverRegistry: [driver],
      driverPreference: 'cli',
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(driver.createdSessions).toHaveLength(0);
    expect(final.status).toBe('completed');
    expect(progress).toEqual(['started', 'runner_invoked', 'persisting_artifact', 'completed']);
  });

  it('honors the AGENTMESA_DRIVER env var for preference', async () => {
    process.env.AGENTMESA_DRIVER = 'cli';
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'Env CLI' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build it',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, { driverRegistry: [driver] });
    expect(driver.createdSessions).toHaveLength(0);
    expect(final.status).toBe('completed');
  });

  it('uses the driver selected by an explicit kind preference', async () => {
    const claudeDriver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const codexDriver = new FakeAgentDriver('codex-app-server', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'Explicit kind' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build it',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, {
      driverRegistry: [claudeDriver, codexDriver],
      driverPreference: 'codex-app-server',
    });

    expect(final.status).toBe('completed');
    expect(claudeDriver.createdSessions).toHaveLength(0);
    expect(codexDriver.createdSessions).toHaveLength(1);
  });

  it('never consults the driver registry on dry runs', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const task = createTask(ctx, { title: 'Dry run' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Build it',
      taskId: task.id,
      action: 'implement',
    });

    const progress: string[] = [];
    const { run: final } = await executeRun(ctx, run.id, {
      dryRun: true,
      driverRegistry: [driver],
      onProgress: (event) => {
        progress.push(event.stage);
      },
    });

    expect(driver.createdSessions).toHaveLength(0);
    expect(final.status).toBe('completed');
    expect(progress).toEqual(['started', 'runner_invoked', 'completed']);
  });
});

describe('executeDriverTurn (direct export)', () => {
  it('runs one turn and persists the handle without going through a run', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', DEFAULT_EVENTS);
    const meeting = createMeeting(ctx, { title: 'Direct call' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'Direct prompt',
      action: 'custom',
      runnerType: 'session',
    });

    const outcome = await executeDriverTurn(ctx, {
      run,
      driver,
      runnerType: 'session',
    });

    expect(outcome.resumed).toBe(false);
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.runnerType).toBe('session');
    expect(outcome.result.output).toContain('Done: implemented the feature.');
    expect(outcome.handle).toBeDefined();
    expect(outcome.handle!.backendSessionId).toBe(driver.createdSessions[0]!.backendSessionId);
    expect(driver.createdSessions[0]!.closed).toBe(true);

    const after = getAgentRun(ctx, run.id);
    expect(after.status).toBe('pending'); // direct calls do not touch the run state machine
  });
});

describe('executeRun permission bridge integration', () => {
  it('judges gated actions through the policy bridge instead of deny-all', async () => {
    // DEFAULT_EVENTS yields a tool-kind permission_request with an empty
    // detail; the real SDK driver carries the tool name — mirror that here.
    const events: EventFactory = (session, prompt) => [
      { type: 'text', text: 'Working on it.' },
      {
        type: 'permission_request',
        request: {
          requestId: 'perm-1',
          kind: 'tool',
          title: 'bash: ls -la',
          detail: { toolName: 'bash', input: { command: 'ls -la' } },
        },
      },
      { type: 'text', text: 'Done: implemented the feature.' },
      { type: 'turn_complete', success: true, summary: 'Implemented the feature' },
    ];
    const driver = new FakeAgentDriver('claude-agent-sdk', events);
    const decisions: Array<{ kind: string; decision: string; rule: string }> = [];
    const task = createTask(ctx, { title: 'Bridge test', createdBy: 'user:test' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Implement X',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, attachPermissionResponder(
      { driverRegistry: [driver] },
      {
        ctx,
        // agent:claude is registered with roles: ['builder'] — the bridge
        // must resolve its identity from the run's agent, judging `bash`
        // (mapped to run_command) under builder capabilities.
        actor: {
          id: 'agent:claude',
          type: 'agent',
          roles: ['builder'],
          client: 'claude-code',
        },
        onDecision: (record) => {
          decisions.push({ kind: record.kind, decision: record.decision, rule: record.rule });
        },
      },
    ));

    expect(final.status).toBe('completed');
    // The permission_request from DEFAULT_EVENTS (bash tool) went through the
    // bridge: a decision was recorded and the turn was allowed to complete.
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.decision === 'allow' || d.decision === 'deny')).toBe(true);
    // run_command is within builder capabilities → allow.
    expect(decisions[0]).toMatchObject({ decision: 'allow', kind: 'tool' });
  });

  it('denies gated commands for actors without run_command capability', async () => {
    const driver = new FakeAgentDriver('claude-agent-sdk', () => [
      { type: 'text', text: 'Trying something' },
      {
        type: 'permission_request',
        request: {
          requestId: 'perm-1',
          kind: 'command',
          title: 'bash: git push origin main',
          detail: { command: 'git push origin main' },
        },
      },
      { type: 'turn_complete', success: true, summary: 'done' },
    ]);
    const decisions: Array<{ decision: string; rule: string }> = [];
    const task = createTask(ctx, { title: 'Deny test', createdBy: 'user:test' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      input: 'Push it',
      taskId: task.id,
      action: 'implement',
    });

    const { run: final } = await executeRun(ctx, run.id, attachPermissionResponder(
      { driverRegistry: [driver] },
      {
        ctx,
        // documenter lacks run_command → the git push command must be denied.
        actor: {
          id: 'agent:doc',
          type: 'agent',
          roles: ['documenter'],
          client: 'claude-code',
        },
        onDecision: (record) => {
          decisions.push({ decision: record.decision, rule: record.rule });
        },
      },
    ));

    expect(decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ decision: 'deny' });
    expect(final.status).toBe('completed');
  });
});
