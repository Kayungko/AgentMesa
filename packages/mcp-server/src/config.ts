/**
 * MCP server launch configuration (M3 Broad Access).
 *
 * Transport selection: `--transport stdio|http` (or `AGENTMESA_MCP_TRANSPORT`),
 * default stdio so existing Claude Code / Codex integrations are unchanged.
 * HTTP-only knobs (`--host`, `--port`, `--token`) mirror the
 * `AGENTMESA_HTTP_*` environment variables.
 */

export type McpTransportKind = 'stdio' | 'http';

export interface ServerConfig {
  transport: McpTransportKind;
  host: string;
  port: number;
  token?: string;
}

export function parseServerConfig(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const args = parseArgs(argv);

  const transportRaw = args['transport'] ?? env['AGENTMESA_MCP_TRANSPORT'] ?? 'stdio';
  if (transportRaw !== 'stdio' && transportRaw !== 'http') {
    throw new Error(`Invalid transport "${transportRaw}" — expected "stdio" or "http".`);
  }

  const host = args['host'] ?? env['AGENTMESA_HTTP_HOST'] ?? '127.0.0.1';

  const portRaw = args['port'] ?? env['AGENTMESA_HTTP_PORT'] ?? '8765';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid HTTP port "${portRaw}" — expected an integer in [0, 65535].`);
  }

  const token = args['token'] ?? env['AGENTMESA_HTTP_TOKEN'] ?? undefined;

  return {
    transport: transportRaw,
    host,
    port,
    ...(token !== undefined && token.trim() !== '' ? { token: token.trim() } : {}),
  };
}

/** Minimal `--key value` / `--key=value` parsing; unknown flags are ignored. */
function parseArgs(argv: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      result[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('--')) {
        result[arg.slice(2)] = value;
        i++;
      } else {
        result[arg.slice(2)] = '';
      }
    }
  }
  return result;
}
