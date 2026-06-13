import {
  createRuntimeContext,
  rebuildAllProjections,
} from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export function runRebuild(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const ctx = createRuntimeContext({
    rootDir,
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
  const json = !!args.flags['json'];
  const clean = args.flags.clean !== false; // default true

  try {
    const result = rebuildAllProjections(ctx, { clean });
    outputResult(result, json, () => {
      printSuccess(`Rebuilt ${result.tasks} task(s), ${result.meetings} meeting(s), ${result.agents} agent(s)${clean ? ' (clean)' : ''}.`);
    });
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
