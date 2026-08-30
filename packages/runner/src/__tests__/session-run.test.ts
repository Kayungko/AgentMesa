import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createMeeting,
  registerAgent,
  createAgentRun,
  listMessages,
  listMeetings,
  listAgentRuns,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeSessionRun, activateSessionAgent } from '../session-run.js';
import type {
  AgentDriver,
  AgentDriverSession,
  DriverEvent,
  DriverKind,
  DriverSessionHandle,
  DriverSessionInit,
  DriverTurnInput,
} from '../drivers/types.js';

let dir: string;
let ctx: MesaRuntimeContext;
let echoScript: string;
let failScript: string;
const prevClaudeCmd = process.env.AGENTMESA_CLAUDE_CMD;
const prevDriverEnv = process.env.AGENTMESA_DRIVER;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-run-'));
  initWorkspace(dir);
  ctx = createRuntimeContext({
    rootDir: dir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
  registerAgent(ctx, { id: 'agent:claude', name: 'Claude', client: 'claude', status: 'available', roles: ['builder'] });
  echoScript = join(dir, 'echo.mjs');
  failScript = join(dir, 'fail.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('AGENT-CONTRIBUTION:'+s));",
  );
  writeFileSync(failScript, 'process.exit(2);');
  delete process.env.AGENTMESA_DRIVER;
});

afterEach(() => {
  if (prevClaudeCmd === undefined) delete process.env.AGENTMESA_CLAUDE_CMD;
  else process.env.AGENTMESA_CLAUDE_CMD = prevClaudeCmd;
  if (prevDriverEnv === undefined) delete process.env.AGENTMESA_DRIVER;
  else process.env.AGENTMESA_DRIVER = prevDriverEnv;
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Minimal fake deep driver (same handwork as run-executor-driver.test.ts)
// ---------------------------------------------------------------------------

class FakeSession implements AgentDriverSession {
  readonly createdAt = new Date().toISOString();
  closed = false;
  receivedPrompts: string[] = [];
  permissionCalls: Array<{ requestId: string; decision: 'allow' | 'deny' }> = [];

  constructor(
    readonly kind: DriverKind,
    readonly backendSessionId: string,
  ) {}

  async *send(input: DriverTurnInput): AsyncIterableIterator<DriverEvent> {
    this.receivedPrompts.push(input.prompt);
    yield { type: 'text', text: `DEEP:${input.prompt}` };
    yield {
      type: 'permission_request',
      request: { requestId: 'perm-1', kind: 'tool', title: 'bash: ls', detail: {} },
    };
    yield { type: 'turn_complete', success: true, summary: 'deep turn done' };
  }

  async respondPermission(requestId: string, decision: 'allow' | 'deny'): Promise<void> {
    this.permissionCalls.push({ requestId, decision });
  }

  async interrupt(): Promise<void> {}

  handle(): DriverSessionHandle {
    return { kind: this.kind, backendSessionId: this.backendSessionId, createdAt: this.createdAt };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeDriver implements AgentDriver {
  readonly name: string;
  createdSessions: FakeSession[] = [];

  constructor(readonly kind: DriverKind) {
    this.name = kind;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(_init: DriverSessionInit): Promise<AgentDriverSession> {
    const session = new FakeSession(this.kind, `sess-${this.createdSessions.length + 1}`);
    this.createdSessions.push(session);
    return session;
  }

  async resumeSession(handle: DriverSessionHandle, _init: DriverSessionInit): Promise<AgentDriverSession> {
    const session = new FakeSession(this.kind, handle.backendSessionId);
    this.createdSessions.push(session);
    return session;
  }
}

describe('executeSessionRun', () => {
  it('drives a pending session run to completed and writes the output back as an agent message', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const meeting = createMeeting(ctx, { title: '协作会话' });

    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: '会话上下文',
      action: 'custom',
      runnerType: 'session',
    });

    const result = await executeSessionRun(ctx, run.id, { writeBackToMeetingId: meeting.id });

    expect(result.run.status).toBe('completed');
    const messages = listMessages(ctx).filter((m) => m.meetingId === meeting.id);
    expect(messages.some((m) => m.from === 'agent:claude' && m.type === 'implementation_summary')).toBe(true);
    expect(messages.some((m) => (m.body ?? '').includes('AGENT-CONTRIBUTION:会话上下文'))).toBe(true);
  });

  it('marks the run failed and posts a general message when the CLI fails', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${failScript}`;
    const meeting = createMeeting(ctx, { title: '失败会话' });

    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: '上下文',
      action: 'custom',
      runnerType: 'session',
    });

    const result = await executeSessionRun(ctx, run.id, { writeBackToMeetingId: meeting.id });

    expect(result.run.status).toBe('failed');
    const messages = listMessages(ctx).filter((m) => m.meetingId === meeting.id);
    expect(messages.some((m) => m.from === 'agent:claude' && m.type === 'general')).toBe(true);
  });

  it('does not create a meeting (session run uses an existing one)', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const meeting = createMeeting(ctx, { title: '已有会话' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: '上下文',
      action: 'custom',
      runnerType: 'session',
    });
    await executeSessionRun(ctx, run.id, { writeBackToMeetingId: meeting.id });
    expect(listMeetings(ctx)).toHaveLength(1);
  });
});

describe('executeSessionRun deep-driver passthrough', () => {
  it('forwards driverRegistry, driverPreference and permissionResponder to executeRun', async () => {
    const meeting = createMeeting(ctx, { title: '深度透传' });
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: '深度回合',
      action: 'custom',
      runnerType: 'session',
    });

    const claudeDriver = new FakeDriver('claude-agent-sdk');
    const codexDriver = new FakeDriver('codex-app-server');
    const responderCalls: string[] = [];

    const result = await executeSessionRun(ctx, run.id, {
      writeBackToMeetingId: meeting.id,
      driverRegistry: [claudeDriver, codexDriver],
      // Explicit kind wins even though the agent client maps to claude.
      driverPreference: 'codex-app-server',
      permissionResponder: async (request) => {
        responderCalls.push(request.requestId);
        return 'allow';
      },
    });

    // Registry + preference reached executeRun: the codex driver ran the turn.
    expect(codexDriver.createdSessions).toHaveLength(1);
    expect(claudeDriver.createdSessions).toHaveLength(0);
    expect(codexDriver.createdSessions[0]!.receivedPrompts).toEqual(['深度回合']);
    expect(codexDriver.createdSessions[0]!.closed).toBe(true);

    // The permissionResponder reached the driver turn.
    expect(responderCalls).toEqual(['perm-1']);
    expect(codexDriver.createdSessions[0]!.permissionCalls).toEqual([
      { requestId: 'perm-1', decision: 'allow' },
    ]);

    expect(result.run.status).toBe('completed');
    expect(result.run.output).toContain('DEEP:深度回合');
    const messages = listMessages(ctx).filter((m) => m.meetingId === meeting.id);
    expect(messages.some((m) => (m.body ?? '').includes('DEEP:深度回合'))).toBe(true);
  });

  it('keeps the CLI path byte-for-byte when no deep-driver options are given', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const meeting = createMeeting(ctx, { title: '默认路径' });
    const driver = new FakeDriver('claude-agent-sdk');
    const run = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: 'CLI 回合',
      action: 'custom',
      runnerType: 'session',
    });

    const result = await executeSessionRun(ctx, run.id, { writeBackToMeetingId: meeting.id });

    expect(driver.createdSessions).toHaveLength(0);
    expect(result.run.status).toBe('completed');
    expect(result.run.output).toContain('AGENT-CONTRIBUTION:CLI 回合');
  });
});

describe('activateSessionAgent', () => {
  it('creates a session run (runnerType session), executes it, and writes the reply back', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const meeting = createMeeting(ctx, { title: '激活会话' });

    const { run, executed } = await activateSessionAgent(ctx, meeting.id, 'agent:claude');

    expect(executed).toBe(true);
    expect(run.runnerType).toBe('session');
    expect(run.meetingId).toBe(meeting.id);
    expect(run.status).toBe('completed');
    const messages = listMessages(ctx).filter((m) => m.meetingId === meeting.id);
    expect(messages.some((m) => m.from === 'agent:claude' && m.type === 'implementation_summary')).toBe(true);
  });

  it('does not spawn a second run when one is already active for the agent in the meeting', async () => {
    const meeting = createMeeting(ctx, { title: '防重会话' });
    const existing = createAgentRun(ctx, {
      agentId: 'agent:claude',
      meetingId: meeting.id,
      input: '进行中的回合',
      action: 'custom',
      runnerType: 'session',
    });

    const { run, executed } = await activateSessionAgent(ctx, meeting.id, 'agent:claude');

    expect(executed).toBe(false);
    expect(run.id).toBe(existing.id);
    expect(run.status).toBe('pending');
    // No extra run was created for this agent+meeting.
    const runs = listAgentRuns(ctx, { agentId: 'agent:claude' }).filter((r) => r.meetingId === meeting.id);
    expect(runs).toHaveLength(1);
  });

  it('forwards deep-driver options through executeSessionRun', async () => {
    const meeting = createMeeting(ctx, { title: '深度激活' });
    const driver = new FakeDriver('claude-agent-sdk');

    const { run, executed } = await activateSessionAgent(ctx, meeting.id, 'agent:claude', {
      driverRegistry: [driver],
      driverPreference: 'claude-agent-sdk',
    });

    expect(executed).toBe(true);
    expect(driver.createdSessions).toHaveLength(1);
    expect(driver.createdSessions[0]!.closed).toBe(true);
    expect(run.status).toBe('completed');
    expect(run.output).toContain('DEEP:');
  });
});
