import type { MesaWorkspacePaths } from '@agentmesa/core';
import { getTask } from '@agentmesa/core';
import type { RunOptions, RunResult } from '../types.js';
import { AbstractRunner } from './base-runner.js';
import { buildImplementPrompt, buildFixPrompt } from '../prompt-builder.js';

export class ClaudeRunner extends AbstractRunner {
  constructor(paths: MesaWorkspacePaths, dryRun = false) {
    super(paths, dryRun);
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { startTime } = this.prepareRun(options);
    const isDryRun = this.dryRun || options.dryRun || false;

    const task = getTask(this.paths, options.taskId);
    let prompt: string;
    const artifacts: string[] = [];

    if (options.runnerType === 'claude-implement') {
      prompt = buildImplementPrompt(task, task.context);
    } else if (options.runnerType === 'claude-fix') {
      // In a real scenario, we'd fetch the review artifact content
      // For now, use a placeholder if extraPrompt is provided, otherwise a default
      const reviewContent = options.extraPrompt || 'No review content provided';
      prompt = buildFixPrompt(task, reviewContent);
    } else {
      return this.recordResult(
        options,
        options.runnerType,
        `Unsupported runner type for ClaudeRunner: ${options.runnerType}`,
        artifacts,
        startTime,
        false
      );
    }

    if (options.extraPrompt && options.runnerType !== 'claude-fix') {
      prompt += `\n\nAdditional Instructions:\n${options.extraPrompt}`;
    }

    if (isDryRun) {
      const logContent = this.createRunLog(options, prompt, '[DRY RUN - No execution performed]');
      return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, true);
    }

    // TODO: Actual Claude CLI invocation would go here.
    // For now, store the prompt as the output (the runner framework is ready,
    // but agent process invocation depends on having the Claude CLI available).
    const output = prompt;
    const logContent = this.createRunLog(options, prompt, output);
    artifacts.push(logContent);

    return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, true);
  }
}
