import type { MesaWorkspacePaths } from '@agentmesa/core';
import { MesaError } from '@agentmesa/core';
import type { Runner, RunnerType } from './types.js';
import { ClaudeRunner } from './runners/claude-runner.js';
import { CodexRunner } from './runners/codex-runner.js';
import { ShellRunner } from './runners/shell-runner.js';
import { SessionRunner } from './runners/session-runner.js';

export function createRunner(type: RunnerType, paths: MesaWorkspacePaths, dryRun = false): Runner {
  switch (type) {
    case 'claude-implement':
    case 'claude-fix':
      return new ClaudeRunner(paths, dryRun);
    case 'codex-review':
    case 'codex-test':
      return new CodexRunner(paths, dryRun);
    case 'shell-check':
      return new ShellRunner(paths, dryRun);
    case 'document':
      // Document runner uses Claude for now (can be separated later)
      return new ClaudeRunner(paths, dryRun);
    case 'session':
      return new SessionRunner(paths, dryRun);
    default:
      throw new MesaError('VALIDATION_ERROR', `Unknown runner type: ${type}`);
  }
}
