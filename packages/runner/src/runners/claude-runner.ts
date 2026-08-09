import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createRuntimeContext, getTask } from '@agentmesa/core';
import type { RunOptions, RunResult } from '../types.js';
import { AbstractRunner } from './base-runner.js';
import { runCli } from './cli-runner.js';
import { buildImplementPrompt, buildFixPrompt } from '../prompt-builder.js';

export class ClaudeRunner extends AbstractRunner {
  constructor(paths: MesaWorkspacePaths, dryRun = false) {
    super(paths, dryRun);
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { startTime } = this.prepareRun(options);
    const isDryRun = this.dryRun || options.dryRun || false;

    const ctx = createRuntimeContext({
      rootDir: this.paths.rootDir,
      actor: {
        id: options.agentId,
        type: 'agent',
        roles: ['builder'],
        client: 'claude-code',
      },
    });
    const task = getTask(ctx, options.taskId);
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

    const cliCommand = process.env.AGENTMESA_CLAUDE_CMD?.trim() || ctx.config.runners?.claudeCmd?.trim();
    let output: string;
    let success = true;
    if (cliCommand) {
      const res = runCli({
        command: cliCommand,
        prompt,
        cwd: this.paths.rootDir,
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      });
      output = res.output;
      success = res.success;
    } else {
      // Stub: framework ready, no CLI configured — echo the prompt back.
      output = prompt;
    }

    const logContent = this.createRunLog(options, prompt, output);
    artifacts.push(logContent);

    return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, success);
  }
}
