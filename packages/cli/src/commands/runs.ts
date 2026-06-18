import {
  createRuntimeContext,
  createAgentRun,
  updateAgentRunStatus,
  getAgentRun,
  listAgentRuns,
} from '@agentmesa/core';
import { executeRun } from '@agentmesa/runner';
import type { RunStatus, RunAction } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export async function runRuns(args: ParsedArgs): Promise<void> {
  const rootDir = process.cwd();
  const ctx = createRuntimeContext({
    rootDir,
    actor: {
      id: 'user:local',
      type: 'user',
      roles: ['owner'],
    },
  });
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'create': {
        const input = args.positional[0];
        if (!input) {
          console.log('Usage: mesa runs create <input> [--agent <id>] [--task <id>] [--action <act>]');
          return;
        }
        const agentId = typeof args.flags['agent'] === 'string' ? args.flags['agent'] : 'user:local';
        const taskId = typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined;
        const action = typeof args.flags['action'] === 'string'
          ? (args.flags['action'] as RunAction)
          : 'implement';
        const runnerType = typeof args.flags['runner'] === 'string' ? args.flags['runner'] : undefined;

        const run = createAgentRun(ctx, {
          agentId,
          input,
          taskId,
          action,
          ...(runnerType ? { runnerType } : {}),
        });
        outputResult(run, json, () => printSuccess(`Created run ${run.id} (${run.status})`));
        return;
      }

      case 'list': {
        const agentId = typeof args.flags['agent'] === 'string' ? args.flags['agent'] : undefined;
        const taskId = typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined;
        const status = typeof args.flags['status'] === 'string'
          ? (args.flags['status'] as RunStatus)
          : undefined;

        const runs = listAgentRuns(ctx, { agentId, taskId, status });
        outputResult(runs, json, () => {
          if (runs.length === 0) {
            console.log('No agent runs found. Create one with: mesa runs create <input>');
          } else {
            console.log(`\n  ${'ID'.padEnd(12)} ${'Status'.padEnd(12)} ${'Action'.padEnd(12)} ${'Agent'.padEnd(14)} ${'Input'}`);
            console.log(`  ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(14)} ${'─'.repeat(30)}`);
            for (const r of runs) {
              const id = r.id.padEnd(12);
              const statusStr = r.status.padEnd(12);
              const actionStr = r.action.padEnd(12);
              const agentStr = r.agentId.padEnd(14);
              const inputStr = (r.inputSummary || r.input).slice(0, 30);
              console.log(`  ${id} ${statusStr} ${actionStr} ${agentStr} ${inputStr}`);
            }
            console.log(`\n  ${runs.length} run(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const runId = args.positional[0];
        if (!runId) {
          console.log('Usage: mesa runs show <runId>');
          return;
        }
        const run = getAgentRun(ctx, runId);
        outputResult(run, json, () => {
          console.log(`\n  ID          : ${run.id}`);
          console.log(`  Status      : ${run.status}`);
          console.log(`  Action      : ${run.action}`);
          console.log(`  Agent       : ${run.agentId}`);
          if (run.taskId) console.log(`  Task        : ${run.taskId}`);
          if (run.meetingId) console.log(`  Meeting     : ${run.meetingId}`);
          console.log(`  Input       : ${run.input}`);
          if (run.outputSummary) console.log(`  Output      : ${run.outputSummary}`);
          if (run.error) console.log(`  Error       : ${run.error}`);
          if (run.producedArtifactIds.length > 0) console.log(`  Artifacts   : ${run.producedArtifactIds.join(', ')}`);
          console.log(`  Started     : ${run.startedAt}`);
          if (run.completedAt) console.log(`  Completed   : ${run.completedAt}`);
          if (run.duration !== undefined) console.log(`  Duration    : ${run.duration}ms`);
          console.log('');
        });
        return;
      }

      case 'complete': {
        const runId = args.positional[0];
        if (!runId) {
          console.log('Usage: mesa runs complete <runId> [--output <summary>] [--artifact <id>]');
          return;
        }
        const output = typeof args.flags['output'] === 'string' ? args.flags['output'] : undefined;
        const artifactId = typeof args.flags['artifact'] === 'string' ? args.flags['artifact'] : undefined;
        const patch: Parameters<typeof updateAgentRunStatus>[3] = {};
        if (output) patch.outputSummary = output;
        if (artifactId) patch.producedArtifactIds = [artifactId];

        const run = updateAgentRunStatus(ctx, runId, 'completed', patch);
        outputResult(run, json, () => printSuccess(`Run ${run.id} completed (${run.duration}ms)`));
        return;
      }

      case 'exec': {
        const runId = args.positional[0];
        if (!runId) {
          console.log('Usage: mesa runs exec <runId> [--dry-run]');
          return;
        }
        const dryRun = !!args.flags['dry-run'];
        const { run } = await executeRun(ctx, runId, { dryRun });
        outputResult(run, json, () => {
          if (run.status === 'completed') {
            printSuccess(`Run ${run.id} completed (${run.duration}ms)`);
            if (run.producedArtifactIds.length > 0) {
              console.log(`  Artifacts: ${run.producedArtifactIds.join(', ')}`);
            }
          } else {
            printError(`Run ${run.id} ${run.status}: ${run.error ?? 'unknown error'}`);
          }
        });
        if (run.status === 'failed') process.exitCode = 1;
        return;
      }

      default:
        console.log('Usage: mesa runs <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  create <input>          Create a new agent run (--agent, --task, --action, --runner)');
        console.log('  list                    List agent runs (--agent, --task, --status)');
        console.log('  show <id>               Show agent run details');
        console.log('  complete <id>           Mark agent run as completed');
        console.log('  exec <id>               Execute a pending agent run (--dry-run)');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
