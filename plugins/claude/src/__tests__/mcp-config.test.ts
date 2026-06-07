import { describe, it, expect } from 'vitest';
import { generateMcpConfig } from '../generators/mcp-config.js';

describe('generateMcpConfig', () => {
  it('should generate default MCP config', () => {
    const config = generateMcpConfig();
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers.agentmesa).toBeDefined();
    expect(config.mcpServers.agentmesa.command).toBe('node');
    expect(config.mcpServers.agentmesa.args).toContain('serve');
    expect(config.mcpServers.agentmesa.args).toContain('--mcp');
  });

  it('should use custom mcpServerPath when provided', () => {
    const config = generateMcpConfig({ mcpServerPath: '/custom/path/server.js' });
    expect(config.mcpServers.agentmesa.args[0]).toBe('/custom/path/server.js');
  });

  it('should use custom nodePath when provided', () => {
    const config = generateMcpConfig({ nodePath: '/usr/local/bin/node' });
    expect(config.mcpServers.agentmesa.command).toBe('/usr/local/bin/node');
  });

  it('should use both custom paths when provided', () => {
    const config = generateMcpConfig({
      nodePath: '/opt/node',
      mcpServerPath: '/opt/mesa/server.js',
    });
    expect(config.mcpServers.agentmesa.command).toBe('/opt/node');
    expect(config.mcpServers.agentmesa.args[0]).toBe('/opt/mesa/server.js');
  });
});
