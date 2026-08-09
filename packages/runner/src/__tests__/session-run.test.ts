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
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeSessionRun } from '../session-run.js';

let dir: string;
let ctx: MesaRuntimeContext;
let echoScript: string;
let failScript: string;
const prevClaudeCmd = process.env.AGENTMESA_CLAUDE_CMD;

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
});

afterEach(() => {
  if (prevClaudeCmd === undefined) delete process.env.AGENTMESA_CLAUDE_CMD;
  else process.env.AGENTMESA_CLAUDE_CMD = prevClaudeCmd;
  rmSync(dir, { recursive: true, force: true });
});

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
