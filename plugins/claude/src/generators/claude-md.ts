import type { TaskStatus, AgentRole } from '@agentmesa/protocol';

export interface ClaudeMdOptions {
  projectName?: string;
  tasks?: { id: string; title: string; status: TaskStatus }[];
  agents?: { id: string; name: string; roles: AgentRole[] }[];
}

function buildBuilderRules(): string {
  return [
    '## AgentMesa Builder Rules',
    '',
    'When implementing a task assigned to you via AgentMesa:',
    '',
    '1. **Update status**: Call `mesa_update_status` with `status: "ready_for_review"` when done.',
    '2. **Write summary**: Call `mesa_attach_artifact` with `kind: "implementation_summary"` describing what you changed.',
    '3. **Attach files**: List all changed files in the artifact metadata under `changedFiles`.',
    '4. **Request review**: Call `mesa_request_review` to notify the reviewer.',
    '5. **Do not merge**: Leave merging to the reviewer or maintainer agent.',
    '',
  ].join('\n');
}

function buildFixRules(): string {
  return [
    '## AgentMesa Fix Rules',
    '',
    'When fixing issues from a review report:',
    '',
    '1. **Read review**: Call `mesa_list_artifacts` and read the latest `review_report`.',
    '2. **Fix issues**: Implement the requested changes.',
    '3. **Write fix summary**: Call `mesa_attach_artifact` with `kind: "fix_summary"` describing what you fixed.',
    '4. **Re-request review**: Call `mesa_post_message` with `type: "fix_done"` and request a new review.',
    '',
  ].join('\n');
}

function buildTaskStatusSection(tasks: { id: string; title: string; status: TaskStatus }[]): string {
  if (tasks.length === 0) return '';

  const lines = [
    '## Current Tasks',
    '',
    '| ID | Title | Status |',
    '|----|-------|--------|',
  ];

  for (const task of tasks) {
    lines.push(`| ${task.id} | ${task.title} | ${task.status} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function buildAgentSection(agents: { id: string; name: string; roles: AgentRole[] }[]): string {
  if (agents.length === 0) return '';

  const lines = [
    '## Available Agents',
    '',
    '| ID | Name | Roles |',
    '|----|------|-------|',
  ];

  for (const agent of agents) {
    lines.push(`| ${agent.id} | ${agent.name} | ${agent.roles.join(', ')} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function buildMcpToolsSection(): string {
  return [
    '## AgentMesa MCP Tools',
    '',
    'The `agentmesa` MCP server exposes the full Mesa state. Common tools:',
    '',
    '- **Tasks**: `mesa_create_task`, `mesa_list_tasks`, `mesa_read_task`, `mesa_update_status`',
    '- **Messages**: `mesa_post_message`, `mesa_request_review`, `mesa_submit_review`, `mesa_list_messages`',
    '- **Artifacts**: `mesa_attach_artifact`, `mesa_list_artifacts`',
    '- **Runs**: `mesa_create_run`, `mesa_exec_run`, `mesa_list_runs`, `mesa_read_run`, `mesa_update_run_status`',
    '- **Workflows**: `mesa_list_workflows`, `mesa_read_workflow`, `mesa_run_workflow`',
    '- **Handoffs**: `mesa_request_handoff`, `mesa_submit_handoff_result`, `mesa_list_handoffs`',
    '',
  ].join('\n');
}

function buildCliReference(): string {
  return [
    '## Mesa CLI Quick Reference',
    '',
    '```bash',
    '# List tasks',
    'mesa task list',
    '',
    '# View task details',
    'mesa task show <task-id>',
    '',
    '# Update task status',
    'mesa task status <task-id> <status>',
    '',
    '# Create a meeting',
    'mesa meeting create --title "Review Task X" --task <task-id>',
    '',
    '# List agents',
    'mesa agent list',
    '',
    '# View messages for a task',
    'mesa message list --task <task-id>',
    '',
    '# Show an artifact',
    'mesa artifact show <artifact-id>',
    '',
    '# Execute an agent run',
    'mesa runs exec <run-id>',
    '',
    '# Drive a workflow to a terminal state',
    'mesa workflow run <workflow-id> --task <task-id>',
    '```',
    '',
  ].join('\n');
}

export function generateClaudeMd(options: ClaudeMdOptions = {}): string {
  const { projectName, tasks, agents } = options;

  const sections: string[] = [];

  sections.push(`# ${projectName ?? 'Project'} — AgentMesa Integration`);
  sections.push('');
  sections.push('This project uses [AgentMesa](https://github.com/agentmesa) for multi-agent coordination.');
  sections.push('');

  sections.push(buildBuilderRules());
  sections.push(buildFixRules());
  sections.push(buildMcpToolsSection());

  if (tasks && tasks.length > 0) {
    sections.push(buildTaskStatusSection(tasks));
  }

  if (agents && agents.length > 0) {
    sections.push(buildAgentSection(agents));
  }

  sections.push(buildCliReference());

  return sections.join('\n');
}
