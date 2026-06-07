import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCheck, ShellNotAllowedError } from '../runner.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-shell-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('runCheck', () => {
  it('runs an allowed command successfully', () => {
    const result = runCheck(testDir, 'echo hello', { allowlist: ['echo'] });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('captures stdout', () => {
    const result = runCheck(testDir, 'echo test output', { allowlist: ['echo'] });
    expect(result.stdout).toBe('test output');
  });

  it('captures failed commands', () => {
    const result = runCheck(testDir, 'node --version', { allowlist: ['node --version'] });
    expect(result.success).toBe(true);
    expect(result.stdout).toMatch(/v\d+\.\d+/);
  });

  it('returns failure for non-zero exit code', () => {
    const result = runCheck(testDir, 'node -e "process.exit(1)"', {
      allowlist: ['node -e'],
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('throws for disallowed commands', () => {
    expect(() => runCheck(testDir, 'rm -rf /')).toThrow(ShellNotAllowedError);
  });

  it('respects custom allowlist', () => {
    expect(() => runCheck(testDir, 'echo hello', { allowlist: ['npm test'] })).toThrow(
      ShellNotAllowedError
    );
  });

  it('can skip allowlist check', () => {
    const result = runCheck(testDir, 'echo bypass', { skipAllowlist: true });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('bypass');
  });
});
