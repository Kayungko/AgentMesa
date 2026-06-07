/**
 * Options for generating Codex MCP config.
 */
export interface CodexMcpConfigOptions {
  /** Path to the AgentMesa MCP server entry point. */
  mcpServerPath?: string;
}

/**
 * Generates a TOML-formatted MCP server configuration snippet
 * for `.codex/config.toml`.
 *
 * This tells the Codex CLI how to start the AgentMesa MCP server
 * so it can call mesa tools during agent execution.
 */
export function generateCodexMcpConfig(options: CodexMcpConfigOptions = {}): string {
  const {
    mcpServerPath = 'node_modules/@agentmesa/mcp-server/dist/index.js',
  } = options;

  const lines: string[] = [];

  lines.push('# AgentMesa MCP server configuration for Codex CLI');
  lines.push('# Add this to your .codex/config.toml');
  lines.push('');
  lines.push('[mcp_servers.agentmesa]');
  lines.push('command = "node"');
  lines.push(`args = ["${mcpServerPath}", "serve", "--mcp"]`);
  lines.push('');

  return lines.join('\n');
}
