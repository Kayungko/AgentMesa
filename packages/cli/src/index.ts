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
import { runRebuild } from './commands/rebuild.js';
import { runPolicyCheck, runPolicyInspect } from './commands/policy.js';
import { runRuns } from './commands/runs.js';
import { runWorkflow } from './commands/workflow.js';
import { runChecks } from './commands/checks.js';
import { runGithub } from './commands/github.js';
import { runDesk } from './commands/desk.js';
import { runPlugin } from './commands/plugin.js';
import { runWorkspace } from './commands/workspace.js';

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

  case 'rebuild':
    runRebuild(args);
    break;

  case 'runs':
    void runRuns(args);
    break;

  case 'workflow':
    void runWorkflow(args);
    break;

  case 'checks':
    runChecks(args);
    break;

  case 'github':
    void runGithub(args);
    break;

  case 'desk':
    void runDesk(args);
    break;

  case 'plugin':
    runPlugin(args);
    break;

  case 'policy':
    if (args.subcommand === 'check') {
      runPolicyCheck(args);
    } else if (args.subcommand === 'inspect') {
      runPolicyInspect(args);
    } else {
      runPolicyInspect(args);
    }
    break;

  case 'workspace':
    runWorkspace(args);
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
  agent show <id>             Show agent details

Inspection Commands:
  doctor [--fix]              Check workspace health (--fix removes orphaned temp files)
  rebuild                     Rebuild all projections from events
  events list [filters]       List events (--meeting, --task, --type, --actor)
  timeline <id>                Auto-detect task or meeting timeline
  timeline task <id>           Show task event timeline + projection
  timeline meeting <id>        Show meeting event timeline + projection
  transports                  List available transports and capabilities
  transports list              Same as 'mesa transports'
  transports inspect <name>    Show transport details (policy-gated)
  transports inbox <name>      List inbound envelopes (--status pending|processed|failed)
  transports outbox <name>     List outbound envelopes (--status pending|processed|failed)
  runs create <input>          Create a new agent run
  runs list                    List agent runs (--agent, --task, --status)
  runs show <id>               Show agent run details
  runs complete <id>           Mark agent run as completed
  runs exec <id>               Execute a pending agent run (--dry-run)
  workflow start <taskId>      Start a workflow for a task (--definition <id>)
  workflow status <id>         Show workflow status and history
  workflow approve <id>        Approve a workflow waiting on human approval
  workflow run <id>            Advance a running workflow
  checks list                  List check results (--task, --kind, --status)
  checks show <id>             Show check result details
  github link-pr <task> <pr>   Link a GitHub pull request to a task (requires gh CLI)
  github import-ci <task>      Import gh run status as check results (--agent)
  desk [--port <n>]            Start the Mesa Desk web dashboard (default port 3456)
  plugin status                Show CLI / MCP / runner integration status
  plugin install <claude|codex>  Register agentmesa MCP with the CLI (user scope)
                   --project <dir>  Also write project files into <dir>
  plugin uninstall <claude|codex>  Remove the agentmesa MCP registration
  plugin runner <claude|codex> "<cmd>"  Store runner CLI command in config.json
  plugin runner <claude|codex> --clear  Clear the stored runner command
  policy check <action> <res>  Check if action is allowed for an actor
                   --actor <id> --role <role>
  policy inspect              Show role capability matrix
  workspace list              List registered workspaces + active one
  workspace add <rootDir>     Register a workspace (must be mesa init-ed) [--name <n>]
  workspace use <id>          Set the active workspace
  workspace show [<id>]       Show a workspace (default: active)
  workspace remove <id>       Remove a workspace from the registry

Flags:
  --json        Output in JSON format (safe for local AI consumption)
  -h, --help    Show help

Examples:
  mesa init
  mesa task create "Implement QR login" --assignee claude --reviewer codex
  mesa runs create "Implement login feature" --agent builder-1
  mesa runs list --status pending
  mesa task list --json
  mesa events list --task task_e5f6a7b8 --type task_status_changed
  mesa timeline task_e5f6a7b8    # auto-detect task or meeting
  mesa timeline task task_e5f6a7b8
  mesa transports
  mesa transports inspect "File Transport"
  mesa transports inbox "File Transport" --status pending
  mesa doctor
`);
}
