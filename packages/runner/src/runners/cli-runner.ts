import { spawnSync } from 'node:child_process';

export interface CliInvocation {
  /** Env value, whitespace-split into program + fixed args (e.g. `claude -p`). */
  command: string;
  /** Delivered via stdin — never as a shell string, so prompts can't inject. */
  prompt: string;
  cwd: string;
  timeout?: number;
}

export interface CliResult {
  output: string;
  success: boolean;
}

export function runCli(inv: CliInvocation): CliResult {
  const parts = inv.command.trim().split(/\s+/);
  const program = parts[0]!;
  const args = parts.slice(1);

  const res = spawnSync(program, args, {
    cwd: inv.cwd,
    input: inv.prompt,
    encoding: 'utf-8',
    timeout: inv.timeout ?? 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

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
