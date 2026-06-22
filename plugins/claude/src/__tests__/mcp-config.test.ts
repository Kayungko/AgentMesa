import { describe, it, expect } from 'vitest';
import { generateMcpConfig } from '../generators/mcp-config.js';

describe('generateMcpConfig', () => {
  it('should default to the mesa-mcp bin launcher', () => {
    const config = generateMcpConfig();
    const entry = config.mcpServers.agentmesa;
    expect(entry.command).toBe('mesa-mcp');
    expect(entry.args).toEqual([]);
    expect(entry.cwd).toBe('.');
  });

  it('should emit the env-configured actor defaults', () => {
    const entry = generateMcpConfig().mcpServers.agentmesa;
    expect(entry.env.AGENTMESA_MCP_ACTOR_ID).toBe('agent:claude');
    expect(entry.env.AGENTMESA_MCP_ACTOR_ROLES).toBe('builder');
  });

  it('should honor custom actor id and roles', () => {
    const entry = generateMcpConfig({
      actorId: 'agent:reviewer',
      actorRoles: 'owner,builder',
    }).mcpServers.agentmesa;
    expect(entry.env.AGENTMESA_MCP_ACTOR_ID).toBe('agent:reviewer');
    expect(entry.env.AGENTMESA_MCP_ACTOR_ROLES).toBe('owner,builder');
  });

  it('should honor a custom cwd', () => {
    const entry = generateMcpConfig({ cwd: '/work/space' }).mcpServers.agentmesa;
    expect(entry.cwd).toBe('/work/space');
  });

  it('should fall back to node when mcpServerPath is provided', () => {
    const entry = generateMcpConfig({
      mcpServerPath: 'node_modules/@agentmesa/mcp-server/dist/bin.js',
    }).mcpServers.agentmesa;
    expect(entry.command).toBe('node');
    expect(entry.args[0]).toBe('node_modules/@agentmesa/mcp-server/dist/bin.js');
  });

  it('should use a custom nodePath with mcpServerPath', () => {
    const entry = generateMcpConfig({
      nodePath: '/usr/local/bin/node',
      mcpServerPath: '/opt/mesa/bin.js',
    }).mcpServers.agentmesa;
    expect(entry.command).toBe('/usr/local/bin/node');
    expect(entry.args[0]).toBe('/opt/mesa/bin.js');
  });
});
