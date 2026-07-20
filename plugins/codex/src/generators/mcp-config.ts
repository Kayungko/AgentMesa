/**
 * Options for generating Codex MCP config.
 */
export interface CodexMcpConfigOptions {
  /** Path to the mesa-mcp bin (e.g. node_modules/@agentmesa/mcp-server/dist/bin.js).
   *  When set, the config launches via `node <path>` instead of the `mesa-mcp` bin. */
  mcpServerPath?: string;
  /** Actor id recorded on every mutation/event (AGENTMESA_MCP_ACTOR_ID). */
  actorId?: string;
  /** Comma-separated roles for policy checks (AGENTMESA_MCP_ACTOR_ROLES). */
  actorRoles?: string;
}

/**
 * Generates a TOML-formatted MCP server configuration snippet
 * for `.codex/config.toml`.
 *
 * This tells the Codex CLI how to start the AgentMesa MCP server
 * so it can call mesa tools during agent execution.
 */
export function generateCodexMcpConfig(options: CodexMcpConfigOptions = {}): string {
  const { mcpServerPath, actorId, actorRoles } = options;

  let command: string;
  let args: string[];
  if (mcpServerPath) {
    command = 'node';
    args = [mcpServerPath];
  } else {
    command = 'mesa-mcp';
    args = [];
  }

  const argsToml = `[${args.map((arg) => `"${arg}"`).join(', ')}]`;

  const lines: string[] = [];

  lines.push('# AgentMesa MCP server configuration for Codex CLI');
  lines.push('# Add this to your .codex/config.toml');
  lines.push('');
  lines.push('[mcp_servers.agentmesa]');
  lines.push(`command = "${command}"`);
  lines.push(`args = ${argsToml}`);
  lines.push('');
  lines.push('[mcp_servers.agentmesa.env]');
  lines.push(`AGENTMESA_MCP_ACTOR_ID = "${actorId ?? 'agent:codex'}"`);
  lines.push(`AGENTMESA_MCP_ACTOR_ROLES = "${actorRoles ?? 'builder'}"`);
  lines.push('');

  return lines.join('\n');
}
