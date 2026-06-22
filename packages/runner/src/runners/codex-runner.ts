import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createRuntimeContext, getTask } from '@agentmesa/core';
import type { RunOptions, RunResult } from '../types.js';
import { AbstractRunner } from './base-runner.js';
import { runCli } from './cli-runner.js';
import { buildReviewPrompt, buildTestPrompt } from '../prompt-builder.js';

export class CodexRunner extends AbstractRunner {
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
        roles: ['reviewer'],
        client: 'codex',
      },
    });
    const task = getTask(ctx, options.taskId);
    let prompt: string;
    const artifacts: string[] = [];

    if (options.runnerType === 'codex-review') {
      // In a real scenario, we'd get the git diff. For now use extraPrompt or placeholder.
      const diff = options.extraPrompt || 'No diff provided';
      prompt = buildReviewPrompt(task, diff);
    } else if (options.runnerType === 'codex-test') {
      prompt = buildTestPrompt(task);
      if (options.extraPrompt) {
        prompt += `\n\nAdditional Instructions:\n${options.extraPrompt}`;
      }
    } else {
      return this.recordResult(
        options,
        options.runnerType,
        `Unsupported runner type for CodexRunner: ${options.runnerType}`,
        artifacts,
        startTime,
        false
      );
    }

    if (isDryRun) {
      const logContent = this.createRunLog(options, prompt, '[DRY RUN - No execution performed]');
      return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, true);
    }

    const cliCommand = process.env.AGENTMESA_CODEX_CMD?.trim();
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
