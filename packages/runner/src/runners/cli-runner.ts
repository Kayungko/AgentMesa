import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export interface CliInvocation {
  /** Env value, whitespace-split into program + fixed args (e.g. `claude -p`). */
  command: string;
  /** Delivered via stdin — never as a shell string, so prompts can't inject. */
  prompt: string;
  cwd: string;
  timeout?: number;
  /**
   * Called immediately after spawn so a long-lived host can track the child
   * (e.g. the desk killing in-flight session CLIs on shutdown).
   */
  onSpawn?: (child: ChildProcess) => void;
}

export interface CliResult {
  output: string;
  success: boolean;
}

export function runCli(inv: CliInvocation): CliResult {
  const parts = inv.command.trim().split(/\s+/);
  const program = parts[0]!;
  const args = parts.slice(1);

  // On Windows, CLIs installed via npm are .cmd shims that spawnSync cannot
  // resolve without a shell, so run the configured command line through cmd.
  // The prompt still travels via stdin, never as part of the command line.
  const options = {
    cwd: inv.cwd,
    input: inv.prompt,
    encoding: 'utf-8' as const,
    timeout: inv.timeout ?? 300_000,
    maxBuffer: 10 * 1024 * 1024,
  };
  const res = process.platform === 'win32'
    ? spawnSync(inv.command.trim(), { ...options, shell: true })
    : spawnSync(program, args, options);

  if (res.error) {
    return { output: `CLI invocation failed: ${res.error.message}`, success: false };
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return {
      output: `CLI exited with code ${res.status}: ${res.stderr || res.stdout || ''}`,
      success: false,
    };
  }
  return { output: res.stdout ?? '', success: true };
}

const MAX_CLI_OUTPUT = 10 * 1024 * 1024; // 与 spawnSync maxBuffer 对齐

function truncateOutput(value: string): string {
  return value.length > MAX_CLI_OUTPUT ? value.slice(0, MAX_CLI_OUTPUT) : value;
}

/**
 * Async variant of {@link runCli}. Same semantics (command from env/config,
 * prompt via stdin, win32 via cmd shell) but uses non-blocking `child_process.spawn`
 * so a long-running CLI never stalls the host event loop (used by the session
 * collaboration fire-and-forget path). Errors, non-zero exits and timeouts are
 * folded into a `CliResult` — never thrown.
 */
export function runCliAsync(inv: CliInvocation): Promise<CliResult> {
  return new Promise((resolve) => {
    const parts = inv.command.trim().split(/\s+/);
    const program = parts[0]!;
    const args = parts.slice(1);
    const child = process.platform === 'win32'
      ? spawn(inv.command.trim(), { cwd: inv.cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(program, args, { cwd: inv.cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    inv.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // Two-stage kill: SIGTERM first, SIGKILL if it hasn't closed shortly after.
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
      killer.unref?.();
      settle({ output: `CLI timed out after ${inv.timeout ?? 300_000}ms`, success: false });
    }, inv.timeout ?? 300_000);
    timer.unref?.();

    child.stdout.on('data', (data) => { stdout = truncateOutput(stdout + String(data)); });
    child.stderr.on('data', (data) => { stderr = truncateOutput(stderr + String(data)); });
    child.on('error', (error) => settle({ output: `CLI invocation failed: ${error.message}`, success: false }));
    child.on('close', (code, signal) => {
      // A `null` code with a signal means the host (or our timeout kill) SIGTERM'd
      // the child — that is a failure, not a clean exit.
      if (typeof code === 'number' && code !== 0) {
        settle({ output: `CLI exited with code ${code}: ${stderr || stdout || ''}`, success: false });
      } else if (signal) {
        settle({ output: `CLI terminated by signal ${signal}: ${stderr || stdout || ''}`, success: false });
      } else {
        settle({ output: stdout, success: true });
      }
    });

    // A CLI may close stdin early (e.g. claude -p mode) — EPIPE is not a failure.
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.write(inv.prompt);
    child.stdin.end();
  });
}
