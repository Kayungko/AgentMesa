import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { SessionRunner } from '../runners/session-runner.js';

let dir: string;
let paths: MesaWorkspacePaths;
let echoScript: string;
let prevClaudeCmd: string | undefined;
let prevCodexCmd: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-runner-'));
  paths = initWorkspace(dir);
  echoScript = join(dir, 'echo.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('ECHO:'+s));",
  );
  prevClaudeCmd = process.env.AGENTMESA_CLAUDE_CMD;
  prevCodexCmd = process.env.AGENTMESA_CODEX_CMD;
});

afterEach(() => {
  if (prevClaudeCmd === undefined) delete process.env.AGENTMESA_CLAUDE_CMD;
  else process.env.AGENTMESA_CLAUDE_CMD = prevClaudeCmd;
  if (prevCodexCmd === undefined) delete process.env.AGENTMESA_CODEX_CMD;
  else process.env.AGENTMESA_CODEX_CMD = prevCodexCmd;
  rmSync(dir, { recursive: true, force: true });
});

describe('SessionRunner', () => {
  it('runs the configured CLI and returns its stdout as output', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const runner = new SessionRunner(paths);
    const res = await runner.run({
      taskId: '',
      runnerType: 'session',
      agentId: 'agent:claude',
      extraPrompt: 'session-context-xyz',
    });
    expect(res.success).toBe(true);
    expect(res.output).toContain('session-context-xyz');
    expect(res.output).toContain('ECHO:');
  });

  it('fails explicitly when no CLI command is configured', async () => {
    delete process.env.AGENTMESA_CLAUDE_CMD;
    delete process.env.AGENTMESA_CODEX_CMD;
    const runner = new SessionRunner(paths);
    const res = await runner.run({
      taskId: '',
      runnerType: 'session',
      agentId: 'agent:claude',
      extraPrompt: 'ctx',
    });
    expect(res.success).toBe(false);
    expect(res.output).toContain('not activated');
  });

  it('is a no-op on dry run', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const runner = new SessionRunner(paths);
    const res = await runner.run({
      taskId: '',
      runnerType: 'session',
      agentId: 'agent:claude',
      extraPrompt: 'ctx',
      dryRun: true,
    });
    expect(res.success).toBe(true);
    expect(res.dryRun).toBe(true);
  });
});
