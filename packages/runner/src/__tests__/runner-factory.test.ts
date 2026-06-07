import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createRunner } from '../runner-factory.js';
import { ClaudeRunner } from '../runners/claude-runner.js';
import { CodexRunner } from '../runners/codex-runner.js';
import { ShellRunner } from '../runners/shell-runner.js';
import type { RunnerType } from '../types.js';

describe('createRunner', () => {
  it('creates ClaudeRunner for claude-implement', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('claude-implement', paths);
    expect(runner).toBeInstanceOf(ClaudeRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates ClaudeRunner for claude-fix', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('claude-fix', paths);
    expect(runner).toBeInstanceOf(ClaudeRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates CodexRunner for codex-review', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('codex-review', paths);
    expect(runner).toBeInstanceOf(CodexRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates CodexRunner for codex-test', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('codex-test', paths);
    expect(runner).toBeInstanceOf(CodexRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates ShellRunner for shell-check', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('shell-check', paths);
    expect(runner).toBeInstanceOf(ShellRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates ClaudeRunner for document', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    const runner = createRunner('document', paths);
    expect(runner).toBeInstanceOf(ClaudeRunner);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws MesaError for unknown runner type', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'runner-factory-'));
    const paths = initWorkspace(tmpDir);
    expect(() => createRunner('unknown' as RunnerType, paths)).toThrow('Unknown runner type');
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
