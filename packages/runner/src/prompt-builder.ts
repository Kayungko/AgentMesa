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
