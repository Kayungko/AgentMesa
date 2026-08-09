import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runCli, runCliAsync } from '../runners/cli-runner.js';

/** Remove a temp dir, retrying briefly — a freshly killed child may still hold it. */
function rmSyncRetry(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Busy (EPERM on Windows): the killed child still holds the dir. Wait then retry.
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) { /* busy-wait short */ }
    }
  }
}

let dir: string;
let echoScript: string;
let failScript: string;
let hangScript: string;

beforeEach(() => {
  // os.tmpdir() is space-free on CI/dev, so `node <path>` survives whitespace split.
  dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
  echoScript = join(dir, 'echo.mjs');
  failScript = join(dir, 'fail.mjs');
  hangScript = join(dir, 'hang.mjs');
  writeFileSync(
    echoScript,
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('ECHO:'+s));",
  );
  writeFileSync(failScript, 'process.exit(3);');
  // Keep the event loop alive (interval) so stdin closing does not let the
  // process exit naturally — it must only stop via our timeout kill.
  writeFileSync(hangScript, "process.stdin.on('data',()=>{});setInterval(()=>{},1000);");
});

afterEach(() => {
  rmSyncRetry(dir);
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
    // Without a shell the spawn itself fails (ENOENT); on Windows the cmd
    // shim layer exits non-zero with its own message instead.
    expect(res.output).toMatch(/CLI invocation failed|CLI exited with code/);
  });
});

describe('runCliAsync', () => {
  it('pipes the prompt via stdin and captures stdout on success', async () => {
    const res = await runCliAsync({ command: `node ${echoScript}`, prompt: 'async-prompt', cwd: dir });
    expect(res.success).toBe(true);
    expect(res.output).toContain('async-prompt');
    expect(res.output).toContain('ECHO:');
  });

  it('reports failure with the exit code on non-zero exit', async () => {
    const res = await runCliAsync({ command: `node ${failScript}`, prompt: 'x', cwd: dir });
    expect(res.success).toBe(false);
    expect(res.output).toContain('code 3');
  });

  it('reports failure when the binary is missing', async () => {
    const res = await runCliAsync({ command: 'agentmesa-no-such-bin-xyz', prompt: 'x', cwd: dir });
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/CLI invocation failed|CLI exited with code/);
  });

  it('resolves (does not hang) when the child times out', async () => {
    const res = await runCliAsync({ command: `node ${hangScript}`, prompt: 'x', cwd: dir, timeout: 100 });
    expect(res.success).toBe(false);
    expect(res.output).toContain('timed out');
  });
});
