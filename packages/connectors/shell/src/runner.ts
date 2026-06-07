import { execSync } from 'node:child_process';
import { isCommandAllowed } from './allowlist.js';
import { MesaError } from '@agentmesa/core';

export interface CheckResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  success: boolean;
}

export interface RunCheckOptions {
  timeout?: number;
  allowlist?: string[];
  skipAllowlist?: boolean;
}

export class ShellNotAllowedError extends MesaError {
  constructor(command: string) {
    super('VALIDATION_ERROR', `Command not in allowlist: ${command}`);
    this.name = 'ShellNotAllowedError';
  }
}

export class ShellTimeoutError extends MesaError {
  constructor(command: string, timeout: number) {
    super('VALIDATION_ERROR', `Command timed out after ${timeout}ms: ${command}`);
    this.name = 'ShellTimeoutError';
  }
}

export function runCheck(
  cwd: string,
  command: string,
  options: RunCheckOptions = {}
): CheckResult {
  const { timeout = 30000, allowlist, skipAllowlist = false } = options;

  if (!skipAllowlist && !isCommandAllowed(command, allowlist)) {
    throw new ShellNotAllowedError(command);
  }

  const start = Date.now();

  try {
    const stdout = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      command,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: '',
      duration: Date.now() - start,
      success: true,
    };
  } catch (err: unknown) {
    const error = err as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      killed?: boolean;
    };

    if (error.killed) {
      throw new ShellTimeoutError(command, timeout);
    }

    const stdout = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString() ?? '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() ?? '';

    return {
      command,
      exitCode: error.status ?? 1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      duration: Date.now() - start,
      success: false,
    };
  }
}
