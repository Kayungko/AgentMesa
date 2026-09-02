import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MesaError, createRuntimeContext, initWorkspace, listAgents } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import {
  installAgentProfile,
  listAgentProfiles,
  resolveAgentProfile,
  type ExecFn,
  type ExecResult,
} from '../index.js';

function fakeExec(handler: () => ExecResult): { exec: ExecFn; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    return handler();
  };
  return { exec, calls };
}

const SUCCESS: ExecResult = { status: 0, stdout: 'ok', stderr: '' };

describe('resolveAgentProfile', () => {
  it('resolves the built-in claude profile', () => {
    const profile = resolveAgentProfile('claude');
    expect(profile).toEqual({
      name: 'claude',
      agentId: 'agent:claude',
      agentName: 'Claude Code',
      client: 'claude-code',
      roles: ['builder'],
      integrationSide: 'claude',
    });
  });

  it('resolves the built-in codex profile', () => {
    const profile = resolveAgentProfile('codex');
    expect(profile.agentId).toBe('agent:codex');
    expect(profile.client).toBe('codex');
    expect(profile.roles).toEqual(['reviewer']);
    expect(profile.integrationSide).toBe('codex');
  });

  it('lists exactly the built-in profiles', () => {
    expect(listAgentProfiles().map((p) => p.name).sort()).toEqual(['claude', 'codex']);
  });

  it('throws a VALIDATION_ERROR listing available profiles for unknown names', () => {
    try {
      resolveAgentProfile('cursor');
      expect.unreachable('resolveAgentProfile should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MesaError);
      const error = err as MesaError;
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toContain('cursor');
      expect(error.message).toContain('claude');
      expect(error.message).toContain('codex');
    }
  });
});

describe('installAgentProfile', () => {
  let root: string;
  let ctx: MesaRuntimeContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentmesa-profile-'));
    initWorkspace(root);
    ctx = createRuntimeContext({
      rootDir: root,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('registers the agent and writes project files', () => {
    const result = installAgentProfile(ctx, 'claude');

    expect(result.profile).toBe('claude');
    expect(result.agentId).toBe('agent:claude');
    expect(result.registered).toBe(true);
    expect(result.mcpInstalled).toBe(false);

    const agents = listAgents(ctx);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'agent:claude',
      name: 'Claude Code',
      client: 'claude-code',
      roles: ['builder'],
      status: 'available',
    });

    expect(result.filesWritten.some((file) => file.endsWith('CLAUDE.md'))).toBe(true);
    expect(result.filesWritten.some((file) => file.endsWith('.mcp.json'))).toBe(true);
  });

  it('writes codex project files into the workspace root by default', () => {
    const result = installAgentProfile(ctx, 'codex');

    expect(result.agentId).toBe('agent:codex');
    expect(result.filesWritten.some((file) => file.endsWith('AGENTS.md'))).toBe(true);
    expect(result.filesWritten.some((file) => file.endsWith('config.toml'))).toBe(true);
    expect(result.filesWritten.every((file) => file.startsWith(root))).toBe(true);
  });

  it('is idempotent — reinstalling keeps the existing registry entry', () => {
    installAgentProfile(ctx, 'claude');
    const again = installAgentProfile(ctx, 'claude');

    expect(again.registered).toBe(false);
    expect(listAgents(ctx)).toHaveLength(1);
  });

  it('honours a custom projectDir', () => {
    const target = join(root, 'sub', 'project');
    const result = installAgentProfile(ctx, 'claude', { projectDir: target });

    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(result.filesWritten.every((file) => file.startsWith(target))).toBe(true);
  });

  it('leaves global MCP config untouched without the mcp flag', () => {
    const fake = fakeExec(() => SUCCESS);
    installAgentProfile(ctx, 'claude', { exec: fake.exec });

    expect(fake.calls).toHaveLength(0);
  });

  it('registers the MCP server with the mcp flag', () => {
    const fake = fakeExec(() => SUCCESS);
    const result = installAgentProfile(ctx, 'claude', { mcp: true, exec: fake.exec });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.command).toBe('claude');
    expect(fake.calls[0]!.args.slice(0, 3)).toEqual(['mcp', 'add', 'agentmesa']);
    expect(result.mcpInstalled).toBe(true);
    expect(result.mcpError).toBeUndefined();
  });

  it('reports an MCP registration failure without failing the whole install', () => {
    const fake = fakeExec(() => ({ status: 1, stdout: '', stderr: 'already exists' }));
    const result = installAgentProfile(ctx, 'claude', { mcp: true, exec: fake.exec });

    expect(result.mcpInstalled).toBe(false);
    expect(result.mcpError).toContain('already exists');
    expect(result.registered).toBe(true);
  });

  it('propagates the unknown-profile error', () => {
    expect(() => installAgentProfile(ctx, 'cursor')).toThrow(MesaError);
  });
});
