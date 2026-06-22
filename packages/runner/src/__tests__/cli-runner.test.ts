import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runCli } from '../runners/cli-runner.js';

let dir: string;
let echoScript: string;
let failScript: string;

beforeEach(() => {
  // os.tmpdir() is space-free on CI/dev, so `node <path>` survives whitespace split.
  dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
  echoScript = join(dir, 'echo.mjs');
  failScript = join(dir, 'fail.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('ECHO:'+s));",
  );
  writeFileSync(failScript, 'process.exit(3);');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runCli', () => {
  it('pipes the prompt via stdin and captures stdout on success', () => {
    const res = runCli({ command: `node ${echoScript}`, prompt: 'hello-prompt', cwd: dir });
    expect(res.success).toBe(true);
    expect(res.output).toContain('hello-prompt');
    expect(res.output).toContain('ECHO:');
  });

  it('reports failure with the exit code on non-zero exit', () => {
    const res = runCli({ command: `node ${failScript}`, prompt: 'x', cwd: dir });
    expect(res.success).toBe(false);
    expect(res.output).toContain('code 3');
  });

  it('reports failure when the binary is missing', () => {
    const res = runCli({ command: 'agentmesa-no-such-bin-xyz', prompt: 'x', cwd: dir });
    expect(res.success).toBe(false);
    expect(res.output).toContain('CLI invocation failed');
  });
});
