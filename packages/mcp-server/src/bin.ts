#!/usr/bin/env node
import { resolve } from 'node:path';
import { getActiveWorkspace } from '@agentmesa/core';
import { startServer } from './server.js';

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

startServer(rootDir).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentmesa MCP server failed to start: ${message}\n`);
  process.exit(1);
});
