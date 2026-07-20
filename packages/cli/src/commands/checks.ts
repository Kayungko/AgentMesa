import {
  createRuntimeContext,
  getCheckResult,
  listCheckResults,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { CheckKind, CheckResultStatus } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

export function runChecks(args: ParsedArgs, ctxOverride?: MesaRuntimeContext): void {
  const ctx = ctxOverride ?? createRuntimeContext({
    rootDir: process.cwd(),
    actor: {
      id: 'user:local',
      type: 'user',
      roles: ['owner'],
    },
  });
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'list': {
        const taskId = typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined;
        const kind = typeof args.flags['kind'] === 'string' ? (args.flags['kind'] as CheckKind) : undefined;
        const status = typeof args.flags['status'] === 'string'
          ? (args.flags['status'] as CheckResultStatus)
          : undefined;

        const checks = listCheckResults(ctx, { taskId, kind, status });
        outputResult(checks, json, () => {
          if (checks.length === 0) {
            console.log('No check results found. Import CI results with: mesa github import-ci <taskId>');
          } else {
            console.log(`\n  ${'ID'.padEnd(12)} ${'Status'.padEnd(10)} ${'Kind'.padEnd(10)} ${'Task'.padEnd(14)} ${'Check'}`);
            console.log(`  ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(14)} ${'─'.repeat(30)}`);
            for (const c of checks) {
              const id = c.id.padEnd(12);
              const statusStr = c.status.padEnd(10);
              const kindStr = c.kind.padEnd(10);
              const taskStr = c.taskId.padEnd(14);
              console.log(`  ${id} ${statusStr} ${kindStr} ${taskStr} ${c.checkName}`);
            }
            console.log(`\n  ${checks.length} check(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const checkId = args.positional[0];
        if (!checkId) {
          console.log('Usage: mesa checks show <checkId>');
          return;
        }
        const check = getCheckResult(ctx, checkId);
        outputResult(check, json, () => {
          console.log(`\n  ID          : ${check.id}`);
          console.log(`  Task        : ${check.taskId}`);
          console.log(`  Kind        : ${check.kind}`);
          console.log(`  Status      : ${check.status}`);
          console.log(`  Check       : ${check.checkName}`);
          console.log(`  Success     : ${check.success}`);
          console.log(`  Exit code   : ${check.exitCode}`);
          if (check.summary) console.log(`  Summary     : ${check.summary}`);
          if (check.detail) console.log(`  Detail      : ${check.detail}`);
          if (check.runId) console.log(`  Run         : ${check.runId}`);
          console.log(`  Created     : ${check.createdAt}`);
          console.log('');
        });
        return;
      }

      default:
        console.log('Usage: mesa checks <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  list                    List check results (--task, --kind, --status)');
        console.log('  show <id>               Show check result details');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
