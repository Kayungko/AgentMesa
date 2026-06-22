#!/usr/bin/env node
import { startServer } from './server.js';

startServer(process.cwd()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentmesa MCP server failed to start: ${message}\n`);
  process.exit(1);
});
