import { createWorkspacePaths } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { linkPrToTask, importCIResults } from '@agentmesa/connector-github';
import type { ParsedArgs } from '../parse-args.js';
import { printError, printSuccess, outputResult } from '../output.js';

export async function runGithub(args: ParsedArgs, pathsOverride?: MesaWorkspacePaths): Promise<void> {
  const rootDir = process.cwd();
  const paths = pathsOverride ?? createWorkspacePaths(rootDir);
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'link-pr': {
        const taskId = args.positional[0];
        const prNumberRaw = args.positional[1];
        if (!taskId || !prNumberRaw) {
          console.log('Usage: mesa github link-pr <taskId> <prNumber>');
          return;
        }
        const prNumber = Number(prNumberRaw);
        if (!Number.isInteger(prNumber)) {
          console.log('Usage: mesa github link-pr <taskId> <prNumber> (prNumber must be an integer)');
          return;
        }
        await linkPrToTask(paths, taskId, prNumber);
        outputResult({ taskId, prNumber }, json, () =>
          printSuccess(`Linked PR #${prNumber} to task ${taskId}`),
        );
        return;
      }

      case 'import-ci': {
        const taskId = args.positional[0];
        if (!taskId) {
          console.log('Usage: mesa github import-ci <taskId> [--agent <id>]');
          return;
        }
        const agentId = typeof args.flags['agent'] === 'string' ? args.flags['agent'] : 'user:local';
        const result = await importCIResults(paths, taskId, agentId, rootDir);
        outputResult(result, json, () =>
          printSuccess(`Imported CI results for task ${taskId}: ${result.checkResultIds.length} check(s), artifact ${result.artifactId}`),
        );
        return;
      }

      default:
        console.log('Usage: mesa github <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  link-pr <taskId> <prNumber>   Link a GitHub pull request to a task');
        console.log('  import-ci <taskId>            Import gh run status as check results (--agent)');
        console.log('');
        console.log('Requires the `gh` CLI to be installed and authenticated.');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
