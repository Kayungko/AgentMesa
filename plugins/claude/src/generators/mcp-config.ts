export interface McpConfigOptions {
  mcpServerPath?: string;
  nodePath?: string;
}

export interface McpConfig {
  mcpServers: {
    agentmesa: {
      command: string;
      args: string[];
    };
  };
}

export function generateMcpConfig(options: McpConfigOptions = {}): McpConfig {
  const { mcpServerPath, nodePath } = options;

  const command = nodePath ?? 'node';
  const serverPath = mcpServerPath ?? './node_modules/@agentmesa/mcp-server/dist/index.js';

  return {
    mcpServers: {
      agentmesa: {
        command,
        args: [serverPath, 'serve', '--mcp'],
      },
    },
  };
}
