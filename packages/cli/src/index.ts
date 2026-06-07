#!/usr/bin/env node

import { parseArgs } from './parse-args.js';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runTask } from './commands/task.js';
import { runMessage } from './commands/message.js';
import { runArtifact } from './commands/artifact.js';
import { runMeeting } from './commands/meeting.js';
import { runAgent } from './commands/agent.js';

const args = parseArgs(process.argv);

if (args.flags['help']) {
  printHelp();
  process.exit(0);
}

switch (args.command) {
  case 'init':
    runInit(args);
    break;

  case 'doctor':
    runDoctor(args);
    break;

  case 'task':
    runTask(args);
    break;

  case 'message':
    runMessage(args);
    break;

  case 'artifact':
    runArtifact(args);
    break;

  case 'meeting':
    runMeeting(args);
    break;

  case 'agent':
    runAgent(args);
    break;

  case 'help':
  default:
    printHelp();
    break;
}

function printHelp(): void {
  console.log(`
AgentMesa CLI — AI coding agent meeting layer

Usage: mesa <command> [subcommand] [options]

Commands:
  init                        Initialize AgentMesa workspace
  doctor                      Check workspace health
  task create <title>         Create a new task
  task list                   List all tasks
  task show <id>              Show task details
  task status <id> <status>   Update task status
  task assign <id> <agent>    Assign task to agent
  message list [taskId]       List messages
  artifact list [taskId]      List artifacts
  artifact show <id>          Show artifact details
  meeting create <title>      Create a meeting
  meeting list                List meetings
  meeting show <id>           Show meeting details
  agent add <id> <name>       Register an agent
  agent list                  List registered agents
  help                        Show this help

Flags:
  --json        Output in JSON format
  -h, --help    Show help

Examples:
  mesa init
  mesa task create "Implement QR login" --assignee claude --reviewer codex
  mesa task list
  mesa task status T-0001 in_progress
  mesa agent add claude "Claude Code" builder,planner
`);
}
