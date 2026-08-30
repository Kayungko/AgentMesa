#!/usr/bin/env node
import { resolve } from 'node:path';
import { getActiveWorkspace } from '@agentmesa/core';
import { parseServerConfig } from './config.js';
import { startServer } from './server.js';
import { startHttpServer } from './http-server.js';

// Resolve the workspace root in priority order:
//   1. AGENTMESA_WORKSPACE env — an explicit operator pin (a Codex/Claude
//      session deliberately operating on a project other than its cwd).
//   2. The registry's active workspace — so a session with no explicit pin
//      follows the workspace the Mana desktop is currently switched to,
//      instead of silently staying on a stale project after a switch.
//   3. The caller's cwd — the natural default for a session in a project.
const rootDir = resolve(
  process.env['AGENTMESA_WORKSPACE']?.trim()
    || getActiveWorkspace()?.rootDir
    || process.cwd(),
);

async function main(): Promise<void> {
  const config = parseServerConfig(process.argv.slice(2));
  if (config.transport === 'http') {
    const handle = await startHttpServer(rootDir, {
      host: config.host,
      port: config.port,
      ...(config.token ? { token: config.token } : {}),
    });
    // stderr: MCP stdio clients log it, and it must not pollute stdout
    // protocol traffic (stdout is unused in HTTP mode, but stay consistent).
    process.stderr.write(`agentmesa MCP server (streamable HTTP) listening on ${handle.url}\n`);
    return;
  }
  await startServer(rootDir);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentmesa MCP server failed to start: ${message}\n`);
  process.exit(1);
});
