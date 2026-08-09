import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initWorkspace, createRuntimeContext, createTask } from '@agentmesa/core';
import type { MesaWorkspacePaths, MesaActor } from '@agentmesa/core';
import { CodexRunner } from '../runners/codex-runner.js';

const ACTOR: MesaActor = { id: 'owner-1', type: 'user', roles: ['owner'] };

let dir: string;
let paths: MesaWorkspacePaths;
let taskId: string;
let echoScript: string;
const savedEnv = process.env.AGENTMESA_CODEX_CMD;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-runner-'));
  paths = initWorkspace(dir);
  const ctx = createRuntimeContext({ rootDir: dir, actor: ACTOR });
  taskId = createTask(ctx, { title: 'Review feature' }).id;
  echoScript = join(dir, 'echo.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('REAL-CLI-OUTPUT'));",
  );
  delete process.env.AGENTMESA_CODEX_CMD;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.AGENTMESA_CODEX_CMD;
  else process.env.AGENTMESA_CODEX_CMD = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('CodexRunner CLI invocation', () => {
  it('echoes the prompt (stub) when AGENTMESA_CODEX_CMD is unset', async () => {
    const runner = new CodexRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'codex-review', agentId: 'reviewer' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Review feature');
    expect(result.output).not.toContain('REAL-CLI-OUTPUT');
  });

  it('spawns the configured CLI when AGENTMESA_CODEX_CMD is set', async () => {
    process.env.AGENTMESA_CODEX_CMD = `node ${echoScript}`;
    const runner = new CodexRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'codex-review', agentId: 'reviewer' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('REAL-CLI-OUTPUT');
  });

  it('fails the run when the configured CLI is missing', async () => {
    process.env.AGENTMESA_CODEX_CMD = 'agentmesa-no-such-bin-xyz';
    const runner = new CodexRunner(paths);
    const result = await runner.run({ taskId, runnerType: 'codex-review', agentId: 'reviewer' });

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/CLI invocation failed|CLI exited with code/);
  });
});
