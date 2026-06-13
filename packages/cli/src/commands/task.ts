import {
  createRuntimeContext,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  assignTask,
} from '@agentmesa/core';
import type { TaskStatus } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export function runTask(args: ParsedArgs): void {
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
        const title = args.positional[0];
        if (!title) {
          console.log('Usage: mesa task create <title> [--assignee <agent>] [--reviewer <agent>] [--branch <name>]');
          return;
        }
        const task = createTask(ctx, {
          title,
          assignedTo: typeof args.flags['assignee'] === 'string' ? args.flags['assignee'] : undefined,
          reviewer: typeof args.flags['reviewer'] === 'string' ? args.flags['reviewer'] : undefined,
          branch: typeof args.flags['branch'] === 'string' ? args.flags['branch'] : undefined,
        });
        outputResult(task, json, () => printSuccess(`Created task ${task.id}: ${task.title}`));
        return;
      }

      case 'list': {
        const tasks = listTasks(ctx);
        outputResult(tasks, json, () => {
          if (tasks.length === 0) {
            console.log('No tasks found. Create one with: mesa task create <title>');
          } else {
            console.log(`\n  ${'ID'.padEnd(10)} ${'Status'.padEnd(22)} ${'Title'}`);
            console.log(`  ${'─'.repeat(10)} ${'─'.repeat(22)} ${'─'.repeat(40)}`);
            for (const t of tasks) {
              console.log(`  ${t.id.padEnd(10)} ${t.status.padEnd(22)} ${t.title}`);
            }
            console.log(`\n  ${tasks.length} task(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const taskId = args.positional[0];
        if (!taskId) {
          console.log('Usage: mesa task show <taskId>');
          return;
        }
        outputResult(getTask(ctx, taskId), json);
        return;
      }

      case 'status': {
        const taskId = args.positional[0];
        const newStatus = args.positional[1];
        if (!taskId || !newStatus) {
          console.log('Usage: mesa task status <taskId> <newStatus>');
          console.log('  Statuses: todo, in_progress, ready_for_review, reviewing, changes_requested, approved, done');
          return;
        }
        const task = updateTaskStatus(ctx, taskId, newStatus as TaskStatus);
        outputResult(task, json, () => printSuccess(`Task ${task.id} status: ${task.status}`));
        return;
      }

      case 'assign': {
        const taskId = args.positional[0];
        const assignee = args.positional[1];
        if (!taskId || !assignee) {
          console.log('Usage: mesa task assign <taskId> <agentId> [reviewerId]');
          return;
        }
        const reviewer = args.positional[2];
        const task = assignTask(ctx, taskId, assignee, reviewer);
        outputResult(task, json, () => printSuccess(`Task ${task.id} assigned to ${task.assignedTo}`));
        return;
      }

      default:
        console.log('Usage: mesa task <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  create <title>    Create a new task');
        console.log('  list              List all tasks');
        console.log('  show <id>         Show task details');
        console.log('  status <id> <s>   Update task status');
        console.log('  assign <id> <to>  Assign task to agent');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
