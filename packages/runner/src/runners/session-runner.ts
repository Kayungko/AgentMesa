import { createRuntimeContext, getAgent } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { RunOptions, RunResult } from '../types.js';
import { AbstractRunner } from './base-runner.js';
import { runCliAsync } from './cli-runner.js';
import { trackSessionChild } from '../session-children.js';

/**
 * Runs a session-level collaboration for a real CLI agent. Unlike the task
 * runners, this does not depend on a task — the prompt is the session context
 * (`options.extraPrompt`) built by `buildSessionPrompt`, and the CLI command is
 * resolved from the agent's configured runner (Claude vs Codex). The raw CLI
 * stdout becomes the run output, which the caller writes back into the session.
 */
export class SessionRunner extends AbstractRunner {
  constructor(paths: MesaWorkspacePaths, dryRun = false) {
    super(paths, dryRun);
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { startTime } = this.prepareRun(options);
    const isDryRun = this.dryRun || options.dryRun || false;

    // `getAgent` is a plain storage read (no policy check), so a minimal
    // lookup context suffices to resolve the agent's registration first.
    const lookupCtx = createRuntimeContext({
      rootDir: this.paths.rootDir,
      actor: {
        id: options.agentId,
        type: 'agent',
        roles: ['builder'],
        client: 'claude-code',
      },
    });

    let agent;
    try {
      agent = getAgent(lookupCtx, options.agentId);
    } catch {
      agent = undefined;
    }

    // Carry the agent's registered roles (fallback ['builder'] for unknown
    // agents) so the actor identity matches the registry — the roles are not
    // consumed by this runner today, but keeping them accurate prevents silent
    // divergence if a policy check is ever added on this path.
    const ctx = createRuntimeContext({
      rootDir: this.paths.rootDir,
      actor: {
        id: options.agentId,
        type: 'agent',
        roles: agent?.roles ?? ['builder'],
        client: 'claude-code',
      },
    });
    const isCodex = agent?.client === 'codex';
    const cliCommand = (isCodex
      ? process.env.AGENTMESA_CODEX_CMD?.trim() || ctx.config.runners?.codexCmd?.trim()
      : process.env.AGENTMESA_CLAUDE_CMD?.trim() || ctx.config.runners?.claudeCmd?.trim()) ?? '';

    const prompt = options.extraPrompt ?? '';

    if (isDryRun) {
      return this.recordResult(options, options.runnerType, '[DRY RUN - No execution performed]', [], startTime, true);
    }

    if (!cliCommand) {
      // No CLI configured for this agent side — surface a clear failure so the
      // session timeline shows why the agent did not respond.
      return this.recordResult(
        options,
        options.runnerType,
        `Session agent "${options.agentId}" not activated: no CLI configured (set AGENTMESA_CLAUDE_CMD / AGENTMESA_CODEX_CMD)`,
        [],
        startTime,
        false,
      );
    }

    const res = await runCliAsync({
      command: cliCommand,
      prompt,
      cwd: this.paths.rootDir,
      // Register the child so the desk host can kill in-flight session CLIs on
      // shutdown / workspace switch instead of leaving orphaned processes.
      onSpawn: trackSessionChild,
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });

    // output = the agent's raw contribution; not wrapped in a run log so the
    // caller can post it straight back into the session timeline.
    return this.recordResult(options, options.runnerType, res.output, [], startTime, res.success);
  }
}
