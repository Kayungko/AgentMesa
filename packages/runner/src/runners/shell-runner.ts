import { execSync } from 'node:child_process';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { MesaError } from '@agentmesa/core';
import type { RunOptions, RunResult } from '../types.js';
import { AbstractRunner } from './base-runner.js';

const SHELL_CHECK_ALLOWLIST = [
  'npm test',
  'npm run lint',
  'npm run typecheck',
  'npm run build',
  'pnpm test',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm build',
  'yarn test',
  'yarn lint',
  'yarn typecheck',
  'yarn build',
  'tsc --noEmit',
  'vitest run',
  'eslint',
  'prettier --check',
];

function isCommandAllowed(command: string): boolean {
  return SHELL_CHECK_ALLOWLIST.some((allowed) => command.startsWith(allowed));
}

export class ShellRunner extends AbstractRunner {
  constructor(paths: MesaWorkspacePaths, dryRun = false) {
    super(paths, dryRun);
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { startTime } = this.prepareRun(options);
    const isDryRun = this.dryRun || options.dryRun || false;
    const artifacts: string[] = [];

    if (options.runnerType !== 'shell-check') {
      return this.recordResult(
        options,
        options.runnerType,
        `Unsupported runner type for ShellRunner: ${options.runnerType}`,
        artifacts,
        startTime,
        false
      );
    }

    const command = options.extraPrompt;
    if (!command) {
      return this.recordResult(
        options,
        options.runnerType,
        'No command provided for shell-check runner',
        artifacts,
        startTime,
        false
      );
    }

    if (!isCommandAllowed(command)) {
      return this.recordResult(
        options,
        options.runnerType,
        `Command not in allowlist: ${command}. Allowed commands: ${SHELL_CHECK_ALLOWLIST.join(', ')}`,
        artifacts,
        startTime,
        false
      );
    }

    if (isDryRun) {
      const logContent = this.createRunLog(
        options,
        `Shell check: ${command}`,
        '[DRY RUN - No execution performed]'
      );
      return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, true);
    }

    try {
      const result = execSync(command, {
        cwd: this.paths.rootDir,
        encoding: 'utf-8',
        timeout: options.timeout ?? 60_000,
      });

      const logContent = this.createRunLog(options, `Shell check: ${command}`, result);
      artifacts.push(logContent);
      return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, true);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const logContent = this.createRunLog(
        options,
        `Shell check: ${command}`,
        `Command failed: ${errMsg}`
      );
      artifacts.push(logContent);
      return this.recordResult(options, options.runnerType, logContent, artifacts, startTime, false);
    }
  }
}
