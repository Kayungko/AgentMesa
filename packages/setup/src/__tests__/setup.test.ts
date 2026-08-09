import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initWorkspace } from '@agentmesa/core';
import {
  getRunnerCommands,
  getSetupStatus,
  installMcpIntegration,
  installProjectFiles,
  isIntegrationSide,
  setRunnerCommands,
  uninstallMcpIntegration,
  type ExecFn,
  type ExecResult,
} from '../index.js';

interface FakeExec {
  exec: ExecFn;
  calls: Array<{ command: string; args: string[] }>;
}

function fakeExec(handler: (command: string, args: string[]) => ExecResult): FakeExec {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    return handler(command, args);
  };
  return { exec, calls };
}

const SUCCESS: ExecResult = { status: 0, stdout: 'ok', stderr: '' };

describe('mcp integration', () => {
  it('installs the claude integration with user scope and actor env vars', () => {
    const fake = fakeExec(() => SUCCESS);
    const result = installMcpIntegration('claude', fake.exec);

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.command).toBe('claude');
    const { args } = call;
    expect(args.slice(0, 3)).toEqual(['mcp', 'add', 'agentmesa']);
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('user');
    expect(args).toContain('-e');
    expect(args).toContain('AGENTMESA_MCP_ACTOR_ID=agent:claude');
    expect(args).toContain('AGENTMESA_MCP_ACTOR_ROLES=builder');
    const separator = args.indexOf('--');
    expect(separator).toBeGreaterThan(0);
    expect(args.slice(separator + 1, separator + 2)).toEqual(['node']);
    expect(args[separator + 2]).toContain('mcp-server');
  });

  it('installs the codex integration with --env flags', () => {
    const fake = fakeExec(() => SUCCESS);
    const result = installMcpIntegration('codex', fake.exec);

    expect(result.ok).toBe(true);
    const call = fake.calls[0]!;
    expect(call.command).toBe('codex');
    expect(call.args.slice(0, 3)).toEqual(['mcp', 'add', 'agentmesa']);
    expect(call.args).toContain('--env');
    expect(call.args).toContain('AGENTMESA_MCP_ACTOR_ID=agent:codex');
    expect(call.args).toContain('AGENTMESA_MCP_ACTOR_ROLES=reviewer');
  });

  it('reports CLI errors from install', () => {
    const fake = fakeExec(() => ({ status: 1, stdout: '', stderr: 'already exists' }));
    const result = installMcpIntegration('codex', fake.exec);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('already exists');
    expect(result.command).toContain('codex mcp add');
  });

  it('reports a missing CLI binary from install', () => {
    const error = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const fake = fakeExec(() => ({ status: null, stdout: '', stderr: '', error }));
    const result = installMcpIntegration('codex', fake.exec);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not found on PATH');
  });

  it('uninstalls via mcp remove', () => {
    const fake = fakeExec(() => SUCCESS);
    const result = uninstallMcpIntegration('claude', fake.exec);

    expect(result.ok).toBe(true);
    expect(fake.calls[0]).toEqual({ command: 'claude', args: ['mcp', 'remove', 'agentmesa'] });
  });
});

describe('getSetupStatus', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentmesa-setup-'));
    initWorkspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports installed and missing CLIs deterministically', () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const fake = fakeExec((command, args) => {
      if (command === 'codex' && args.join(' ') === 'mcp get agentmesa') return SUCCESS;
      if (command === 'claude') return { status: null, stdout: '', stderr: '', error: enoent };
      return { status: 1, stdout: '', stderr: 'not found' };
    });

    const status = getSetupStatus(root, fake.exec);
    expect(status.claude).toEqual({ cliAvailable: false, mcpInstalled: false });
    expect(status.codex).toEqual({ cliAvailable: true, mcpInstalled: true });
    expect(status.runnerSources).toEqual({ claude: 'stub', codex: 'stub' });
  });

  it('marks a present CLI without the server as not installed', () => {
    const fake = fakeExec(() => ({ status: 1, stdout: '', stderr: 'no server named agentmesa' }));
    const status = getSetupStatus(root, fake.exec);

    expect(status.claude).toEqual({ cliAvailable: true, mcpInstalled: false });
    expect(status.codex).toEqual({ cliAvailable: true, mcpInstalled: false });
  });

  it('resolves runner sources env > config > stub', () => {
    const fake = fakeExec(() => SUCCESS);
    process.env.AGENTMESA_CLAUDE_CMD = 'claude -p';
    try {
      setRunnerCommands(root, { codexCmd: 'codex exec -' });
      const status = getSetupStatus(root, fake.exec);
      expect(status.runners).toEqual({ codexCmd: 'codex exec -' });
      expect(status.runnerSources.claude).toBe('env');
      expect(status.runnerSources.codex).toBe('config');
    } finally {
      delete process.env.AGENTMESA_CLAUDE_CMD;
    }
  });
});

describe('runner commands', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentmesa-runners-'));
    initWorkspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty when the workspace has no runners', () => {
    expect(getRunnerCommands(root)).toEqual({});
  });

  it('stores and clears runner commands without clobbering other config', () => {
    setRunnerCommands(root, { claudeCmd: 'claude -p', codexCmd: 'codex exec -' });
    expect(getRunnerCommands(root)).toEqual({ claudeCmd: 'claude -p', codexCmd: 'codex exec -' });

    const config = JSON.parse(readFileSync(join(root, '.agentmesa', 'config.json'), 'utf-8'));
    expect(config.policy).toEqual({ mode: 'role-based' });
    expect(config.runners).toEqual({ claudeCmd: 'claude -p', codexCmd: 'codex exec -' });

    setRunnerCommands(root, { claudeCmd: null });
    expect(getRunnerCommands(root)).toEqual({ codexCmd: 'codex exec -' });

    setRunnerCommands(root, { codexCmd: null });
    const cleared = JSON.parse(readFileSync(join(root, '.agentmesa', 'config.json'), 'utf-8'));
    expect(cleared.runners).toBeUndefined();
    expect(cleared.policy).toEqual({ mode: 'role-based' });
  });

  it('rejects directories without a workspace', () => {
    const empty = mkdtempSync(join(tmpdir(), 'agentmesa-nows-'));
    try {
      expect(() => setRunnerCommands(empty, { claudeCmd: 'claude -p' })).toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('installProjectFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentmesa-project-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes claude project files', () => {
    const result = installProjectFiles('claude', root);
    expect(result.filesWritten.some((file) => file.endsWith('CLAUDE.md'))).toBe(true);
    expect(result.filesWritten.some((file) => file.endsWith('.mcp.json'))).toBe(true);

    const mcpJson = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers.agentmesa.env.AGENTMESA_MCP_ACTOR_ROLES).toBe('builder');
  });

  it('writes codex project files', () => {
    const result = installProjectFiles('codex', root);
    expect(result.filesWritten.some((file) => file.endsWith('AGENTS.md'))).toBe(true);
    expect(result.filesWritten.some((file) => file.endsWith('config.toml'))).toBe(true);

    const toml = readFileSync(join(root, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('agentmesa');
  });
});

describe('isIntegrationSide', () => {
  it('accepts claude and codex only', () => {
    expect(isIntegrationSide('claude')).toBe(true);
    expect(isIntegrationSide('codex')).toBe(true);
    expect(isIntegrationSide('cursor')).toBe(false);
  });
});
