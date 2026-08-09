import {
  appendMessage,
  createRuntimeContext,
  getAgent,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeRun, type RunExecutionResult } from './run-executor.js';

const MAX_WRITEBACK_BODY = 50_000;

/** Cap a potentially huge CLI output before posting it into a message body. */
function truncate(value: string, limit = MAX_WRITEBACK_BODY): string {
  return value.length > limit ? `${value.slice(0, limit)}\n…(truncated)` : value;
}

export interface SessionRunOptions {
  timeout?: number;
  /**
   * When set, the run's final output is written back into this meeting as a
   * message authored by the run's agent (so the session timeline shows the
   * agent's actual contribution).
   */
  writeBackToMeetingId?: string;
}

/**
 * Drive a session-collaboration run through the standard `executeRun` state
 * machine (pending → running → completed | failed), then optionally post the
 * agent's output back into the session as a message under the agent's identity.
 */
export async function executeSessionRun(
  ctx: MesaRuntimeContext,
  runId: string,
  options?: SessionRunOptions,
): Promise<RunExecutionResult> {
  const result = await executeRun(ctx, runId, {
    timeout: options?.timeout,
  });

  if (options?.writeBackToMeetingId) {
    await writeBackSessionMessage(ctx, options.writeBackToMeetingId, result);
  }

  return result;
}

async function writeBackSessionMessage(
  ctx: MesaRuntimeContext,
  meetingId: string,
  result: RunExecutionResult,
): Promise<void> {
  const { run } = result;
  const completed = run.status === 'completed';

  let agent;
  try {
    agent = getAgent(ctx, run.agentId);
  } catch {
    agent = undefined;
  }

  // Post under the agent's own identity so the message is attributed to it:
  // `appendMessage` forces `from` to the ctx actor id.
  const agentCtx = createRuntimeContext({
    rootDir: ctx.rootDir,
    actor: {
      id: run.agentId,
      type: 'agent',
      roles: agent?.roles ?? ['builder'],
      client: agent?.client ?? 'claude-code',
    },
  });

  appendMessage(agentCtx, {
    meetingId,
    senderAgentId: run.agentId,
    type: completed ? 'implementation_summary' : 'general',
    summary: completed
      ? `${run.agentId} 完成本轮协作`
      : `${run.agentId} 本轮协作失败`,
    body: truncate(run.output ?? run.error ?? ''),
  });
}
