import type { MesaTask, TaskContext } from '@agentmesa/protocol';

export function buildImplementPrompt(task: MesaTask, context?: TaskContext): string {
  let prompt = `Implement the following task:\n\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Title: ${task.title}\n`;

  if (context?.goal) {
    prompt += `Goal: ${context.goal}\n`;
  } else if (task.context?.goal) {
    prompt += `Goal: ${task.context.goal}\n`;
  }

  if (context?.changedFiles && context.changedFiles.length > 0) {
    prompt += `\nChanged Files:\n${context.changedFiles.map((f) => `- ${f}`).join('\n')}\n`;
  } else if (task.context?.changedFiles && task.context.changedFiles.length > 0) {
    prompt += `\nChanged Files:\n${task.context.changedFiles.map((f) => `- ${f}`).join('\n')}\n`;
  }

  if (context?.commands && context.commands.length > 0) {
    prompt += `\nCommands to run:\n${context.commands.map((c) => `- ${c}`).join('\n')}\n`;
  } else if (task.context?.commands && task.context.commands.length > 0) {
    prompt += `\nCommands to run:\n${task.context.commands.map((c) => `- ${c}`).join('\n')}\n`;
  }

  if (task.branch) {
    prompt += `\nBranch: ${task.branch}\n`;
  }

  prompt += `\nPlease implement this task following best practices and ensuring all tests pass.`;

  return prompt;
}

export function buildFixPrompt(task: MesaTask, reviewContent: string): string {
  let prompt = `Fix the issues found in this review:\n\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Title: ${task.title}\n`;
  prompt += `\nReview Content:\n${reviewContent}\n`;
  prompt += `\nPlease address all issues mentioned in the review and update the implementation accordingly.`;

  return prompt;
}

export function buildReviewPrompt(task: MesaTask, diff: string): string {
  let prompt = `Review the following implementation:\n\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Title: ${task.title}\n`;

  if (task.context?.goal) {
    prompt += `Goal: ${task.context.goal}\n`;
  }

  prompt += `\nDiff:\n\`\`\`\n${diff}\n\`\`\`\n`;
  prompt += `\nPlease review this implementation for correctness, best practices, and potential issues.`;

  return prompt;
}

export function buildTestPrompt(task: MesaTask): string {
  let prompt = `Write and run tests for the following task:\n\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Title: ${task.title}\n`;

  if (task.context?.goal) {
    prompt += `Goal: ${task.context.goal}\n`;
  }

  if (task.context?.changedFiles && task.context.changedFiles.length > 0) {
    prompt += `\nFiles to test:\n${task.context.changedFiles.map((f) => `- ${f}`).join('\n')}\n`;
  }

  prompt += `\nPlease write comprehensive tests and ensure they all pass.`;

  return prompt;
}

export function buildDocumentPrompt(task: MesaTask): string {
  let prompt = `Document the following:\n\n`;
  prompt += `Task ID: ${task.id}\n`;
  prompt += `Title: ${task.title}\n`;

  if (task.context?.goal) {
    prompt += `Goal: ${task.context.goal}\n`;
  }

  if (task.context?.changedFiles && task.context.changedFiles.length > 0) {
    prompt += `\nFiles to document:\n${task.context.changedFiles.map((f) => `- ${f}`).join('\n')}\n`;
  }

  prompt += `\nPlease create clear and comprehensive documentation for this implementation.`;

  return prompt;
}

/**
 * Build the prompt handed to a real CLI agent when it is invited into a session.
 * The agent reads the meeting context (purpose, participants, tasks, recent
 * messages) and produces a reply that is written back into the session.
 */
export function buildSessionPrompt(input: {
  meetingId: string;
  title: string;
  purpose?: string;
  agentId: string;
  agentNames: Record<string, string>;
  tasks: Array<{ id: string; title: string; status: string }>;
  messages: Array<{ from: string; type: string; summary: string; createdAt: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`You have been invited to join an AgentMesa session.`);
  lines.push(``);
  lines.push(`Session: ${input.title}`);
  if (input.purpose) {
    lines.push(`Purpose: ${input.purpose}`);
  }
  lines.push(`Session ID: ${input.meetingId}`);
  lines.push(`Your identity in this session: ${input.agentId}`);
  lines.push(``);

  const names = Object.values(input.agentNames).filter((name) => name && name !== input.agentId);
  if (names.length > 0) {
    lines.push(`Participants in this session:`);
    for (const name of names) {
      lines.push(`- ${name}`);
    }
    lines.push(``);
  }

  if (input.tasks.length > 0) {
    lines.push(`Tasks in this session:`);
    for (const task of input.tasks) {
      lines.push(`- [${task.status}] ${task.title} (${task.id})`);
    }
    lines.push(``);
  } else {
    lines.push(`This session has no tasks yet.`);
    lines.push(``);
  }

  if (input.messages.length > 0) {
    lines.push(`Recent messages:`);
    for (const message of input.messages) {
      lines.push(`- [${message.createdAt}] ${message.from} (${message.type}): ${message.summary}`);
    }
    lines.push(``);
  }

  lines.push(`Please review the context above and share your analysis, plan, or next steps.`);
  lines.push(`Your reply will be published as a message in this session for the other participants.`);
  return lines.join('\n');
}
