import {
  createWorkspacePaths,
  listMessages,
  getMessagesByTask,
} from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printError, formatOutput } from '../output.js';

export function runMessage(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const paths = createWorkspacePaths(rootDir);
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'list': {
        const taskId = args.positional[0] ?? (typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined);
        const messages = taskId ? getMessagesByTask(paths, taskId) : listMessages(paths);
        if (json) {
          formatOutput(messages, true);
        } else {
          if (messages.length === 0) {
            console.log('No messages found.');
          } else {
            console.log(`\n  ${'ID'.padEnd(10)} ${'Type'.padEnd(20)} ${'From'.padEnd(20)} ${'Summary'}`);
            console.log(`  ${'─'.repeat(10)} ${'─'.repeat(20)} ${'─'.repeat(20)} ${'─'.repeat(40)}`);
            for (const m of messages) {
              console.log(`  ${m.id.padEnd(10)} ${m.type.padEnd(20)} ${m.from.padEnd(20)} ${m.summary.slice(0, 40)}`);
            }
            console.log(`\n  ${messages.length} message(s)\n`);
          }
        }
        return;
      }

      default:
        console.log('Usage: mesa message <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  list [taskId]     List messages (optionally filtered by task)');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
