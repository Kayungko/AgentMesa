import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { Runner, RunOptions, RunResult, RunnerType } from '../types.js';

export abstract class AbstractRunner implements Runner {
  protected paths: MesaWorkspacePaths;
  protected dryRun: boolean;

  constructor(paths: MesaWorkspacePaths, dryRun = false) {
    this.paths = paths;
    this.dryRun = dryRun;
  }

  abstract run(options: RunOptions): Promise<RunResult>;

  protected prepareRun(options: RunOptions): { startTime: number } {
    return {
      startTime: Date.now(),
    };
  }

  protected recordResult(
    options: RunOptions,
    runnerType: RunnerType,
    output: string,
    artifacts: string[],
    startTime: number,
    success: boolean
  ): RunResult {
    return {
      success,
      runnerType,
      taskId: options.taskId,
      agentId: options.agentId,
      output,
      artifacts,
      duration: Date.now() - startTime,
      dryRun: this.dryRun || options.dryRun || false,
    };
  }

  protected createRunLog(options: RunOptions, prompt: string, output: string): string {
    const lines: string[] = [];
    lines.push(`# Agent Run Log`);
    lines.push(``);
    lines.push(`- Task: ${options.taskId}`);
    lines.push(`- Agent: ${options.agentId}`);
    lines.push(`- Runner Type: ${options.runnerType}`);
    lines.push(`- Dry Run: ${this.dryRun || options.dryRun || false}`);
    lines.push(`- Timestamp: ${new Date().toISOString()}`);
    lines.push(``);
    lines.push(`## Prompt`);
    lines.push(`\`\`\``);
    lines.push(prompt);
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`## Output`);
    lines.push(`\`\`\``);
    lines.push(output);
    lines.push(`\`\`\``);

    return lines.join('\n');
  }
}
