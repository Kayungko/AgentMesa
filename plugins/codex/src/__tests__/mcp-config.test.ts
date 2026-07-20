import { describe, it, expect } from 'vitest';
import { generateCodexMcpConfig } from '../generators/mcp-config.js';

describe('generateCodexMcpConfig', () => {
  it('should default to the mesa-mcp bin launcher', () => {
    const toml = generateCodexMcpConfig();
    expect(toml).toContain('command = "mesa-mcp"');
    expect(toml).toContain('args = []');
  });

  it('should emit the env-configured actor defaults', () => {
    const toml = generateCodexMcpConfig();
    expect(toml).toContain('AGENTMESA_MCP_ACTOR_ID = "agent:codex"');
    expect(toml).toContain('AGENTMESA_MCP_ACTOR_ROLES = "builder"');
  });

  it('should honor custom actor id and roles', () => {
    const toml = generateCodexMcpConfig({
      actorId: 'agent:reviewer',
      actorRoles: 'owner,builder',
    });
    expect(toml).toContain('AGENTMESA_MCP_ACTOR_ID = "agent:reviewer"');
    expect(toml).toContain('AGENTMESA_MCP_ACTOR_ROLES = "owner,builder"');
  });

  it('should fall back to node when mcpServerPath is provided', () => {
    const toml = generateCodexMcpConfig({
      mcpServerPath: 'node_modules/@agentmesa/mcp-server/dist/bin.js',
    });
    expect(toml).toContain('command = "node"');
    expect(toml).toContain('args = ["node_modules/@agentmesa/mcp-server/dist/bin.js"]');
  });

  it('should not reference the nonexistent serve --mcp command or the old index.js path', () => {
    const toml = generateCodexMcpConfig();
    expect(toml).not.toContain('"serve"');
    expect(toml).not.toContain('"--mcp"');
    expect(toml).not.toContain('index.js');
  });

  it('should be a valid TOML snippet targeting .codex/config.toml', () => {
    const toml = generateCodexMcpConfig();
    expect(toml).toContain('[mcp_servers.agentmesa]');
    expect(toml).toContain('[mcp_servers.agentmesa.env]');
  });
});
