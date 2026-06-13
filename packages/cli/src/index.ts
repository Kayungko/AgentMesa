#!/usr/bin/env node

import { parseArgs } from './parse-args.js';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runTask } from './commands/task.js';
import { runMessage } from './commands/message.js';
import { runArtifact } from './commands/artifact.js';
import { runMeeting } from './commands/meeting.js';
import { runAgent } from './commands/agent.js';
import { runEvents, runTimeline } from './commands/events.js';
import { runTransports } from './commands/transports.js';

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

  case 'events':
    runEvents(args);
    break;

  case 'timeline':
    runTimeline(args);
    break;

  case 'transports':
    runTransports(args);
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

State Commands:
  init                        Initialize AgentMesa workspace
  task create <title>         Create a new task
  task list                   List all tasks
  task show <id>              Show task details
  task status <id> <status>   Update task status
  task assign <id> <agent>    Assign task to agent
  meeting create <title>      Create a meeting
  meeting list                List meetings
  meeting show <id>           Show meeting details
  message list [taskId]       List messages
  artifact list [taskId]      List artifacts
  artifact show <id>          Show artifact details
  agent add <id> <name>       Register an agent
  agent list                  List registered agents

Inspection Commands:
  doctor [--fix]              Check workspace health (--fix removes orphaned temp files)
  events list [filters]       List events (--meeting, --task, --type, --actor)
  timeline <taskId|meetingId> Show event timeline + reconstructed projection
  transports                  List available transports and capabilities

Flags:
  --json        Output in JSON format (safe for local AI consumption)
  -h, --help    Show help

Examples:
  mesa init
  mesa task create "Implement QR login" --assignee claude --reviewer codex
  mesa task list --json
  mesa events list --task task_e5f6a7b8 --type task_status_changed
  mesa timeline task_e5f6a7b8
  mesa transports
  mesa doctor
`);
}
