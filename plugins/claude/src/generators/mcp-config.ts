export interface McpConfigOptions {
  /** Path to the mesa-mcp bin (e.g. node_modules/@agentmesa/mcp-server/dist/bin.js).
   *  When set, the config launches via `node <path>` instead of the `mesa-mcp` bin. */
  mcpServerPath?: string;
  /** Node executable to use when launching via mcpServerPath. */
  nodePath?: string;
  /** Workspace directory the server serves over stdio. */
  cwd?: string;
  /** Actor id recorded on every mutation/event (AGENTMESA_MCP_ACTOR_ID). */
  actorId?: string;
  /** Comma-separated roles for policy checks (AGENTMESA_MCP_ACTOR_ROLES). */
  actorRoles?: string;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  cwd: string;
  env: {
    AGENTMESA_MCP_ACTOR_ID: string;
    AGENTMESA_MCP_ACTOR_ROLES: string;
  };
}

export interface McpConfig {
  mcpServers: {
    agentmesa: McpServerEntry;
  };
}

export function generateMcpConfig(options: McpConfigOptions = {}): McpConfig {
  const { mcpServerPath, nodePath, cwd, actorId, actorRoles } = options;

  let command: string;
  let args: string[];
  if (mcpServerPath) {
    command = nodePath ?? 'node';
    args = [mcpServerPath];
  } else {
    command = 'mesa-mcp';
    args = [];
  }

  return {
    mcpServers: {
      agentmesa: {
        command,
        args,
        cwd: cwd ?? '.',
        env: {
          AGENTMESA_MCP_ACTOR_ID: actorId ?? 'agent:claude',
          AGENTMESA_MCP_ACTOR_ROLES: actorRoles ?? 'builder',
        },
      },
    },
  };
}
