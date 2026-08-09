import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext, createTask } from '@agentmesa/core';
import type { MesaWorkspacePaths, MesaActor } from '@agentmesa/core';
import { ClaudeRunner } from '../runners/claude-runner.js';

const ACTOR: MesaActor = { id: 'owner-1', type: 'user', roles: ['owner'] };

let dir: string;
let paths: MesaWorkspacePaths;
let taskId: string;
let echoScript: string;
const savedEnv = process.env.AGENTMESA_CLAUDE_CMD;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-runner-'));
  paths = initWorkspace(dir);
  const ctx = createRuntimeContext({ rootDir: dir, actor: ACTOR });
  taskId = createTask(ctx, { title: 'Build feature' }).id;
  echoScript = join(dir, 'echo.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('REAL-CLI-OUTPUT'));",
  );
  delete process.env.AGENTMESA_CLAUDE_CMD;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.AGENTMESA_CLAUDE_CMD;
  else process.env.AGENTMESA_CLAUDE_CMD = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('ClaudeRunner CLI invocation', () => {
  it('echoes the prompt (stub) when AGENTMESA_CLAUDE_CMD is unset', async () => {
    const runner = new ClaudeRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'claude-implement', agentId: 'builder' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Build feature');
    expect(result.output).not.toContain('REAL-CLI-OUTPUT');
  });

  it('spawns the configured CLI when AGENTMESA_CLAUDE_CMD is set', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = `node ${echoScript}`;
    const runner = new ClaudeRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'claude-implement', agentId: 'builder' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('REAL-CLI-OUTPUT');
  });

  it('fails the run when the configured CLI is missing', async () => {
    process.env.AGENTMESA_CLAUDE_CMD = 'agentmesa-no-such-bin-xyz';
    const runner = new ClaudeRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'claude-implement', agentId: 'builder' });

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/CLI invocation failed|CLI exited with code/);
  });
});
