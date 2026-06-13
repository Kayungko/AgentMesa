import { initWorkspace, isWorkspaceInitialized } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, printWarning, outputResult } from '../output.js';

export function runInit(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const json = !!args.flags['json'];

  if (isWorkspaceInitialized(rootDir)) {
    if (json) {
      console.log(JSON.stringify({ error: 'Workspace already initialized', rootDir }));
    } else {
      printWarning('AgentMesa workspace already exists in this directory.');
    }
    return;
  }

  try {
    const paths = initWorkspace(rootDir);
    outputResult({ initialized: true, mesaDir: paths.mesaDir, rootDir }, json, () => {
      printSuccess(`Initialized AgentMesa workspace at ${paths.mesaDir}`);
      console.log('');
      console.log('  Created directories:');
      console.log('    tasks/       — task state');
      console.log('    messages/    — agent messages');
      console.log('    artifacts/   — durable outputs');
      console.log('    meetings/    — meeting state');
      console.log('    agents/      — agent registry');
      console.log('    logs/        — execution logs');
      console.log('    locks/       — file locks');
      console.log('    events/      — event log');
      console.log('    projections/ — rebuilt state');
      console.log('');
      console.log('  Next steps:');
      console.log('    mesa task create "My first task"');
      console.log('    mesa agent add claude Claude builder');
    });
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
