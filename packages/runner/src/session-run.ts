import {
  appendMessage,
  createAgentRun,
  createRuntimeContext,
  getAgent,
  getMeeting,
  listAgentRuns,
  listAgents,
  listMessages,
  listTasks,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { executeRun, type RunExecutionResult } from './run-executor.js';
import { buildSessionPrompt } from './prompt-builder.js';

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

export interface ActivateSessionAgentOptions {
  timeout?: number;
}

/**
 * Invite-and-activate shared by the desk invite endpoint and the MCP
 * `mesa_activate_session_agent` tool: ensure the agent is a member, create a
 * `session` run carrying the meeting context, then (fire-and-forget) execute it
 * so the real CLI agent joins the session and its reply lands in the timeline.
 *
 * Returns the created run. The caller decides whether to await the execution
 * (desk fire-and-forgets it) or run it detached.
 */
export async function activateSessionAgent(
  ctx: MesaRuntimeContext,
  meetingId: string,
  agentId: string,
  options?: ActivateSessionAgentOptions,
): Promise<{ run: import('@agentmesa/protocol').MesaAgentRun; executed: boolean }> {
  // 防重：该 agent 在此会话已有进行中的 run 则跳过，避免重复 spawn。
  const hasActive = listAgentRuns(ctx, { agentId })
    .filter((run) => run.meetingId === meetingId)
    .some((run) => run.status === 'pending' || run.status === 'running');
  if (hasActive) {
    const existing = listAgentRuns(ctx, { agentId })
      .find((run) => run.meetingId === meetingId && (run.status === 'pending' || run.status === 'running'));
    return { run: existing!, executed: false };
  }

  const meeting = getMeeting(ctx, meetingId);
  const tasks = listTasks(ctx).filter((task) => meeting.tasks.includes(task.id));
  const messages = listMessages(ctx)
    .filter((message) => message.meetingId === meetingId)
    .slice(-20);
  const agentNames = Object.fromEntries(
    listAgents(ctx).map((agent) => [agent.id, agent.name]),
  );

  const prompt = buildSessionPrompt({
    meetingId,
    title: meeting.title,
    purpose: meeting.purpose,
    agentId,
    agentNames,
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
    messages: messages.map((message) => ({
      from: message.from,
      type: message.type,
      summary: message.summary,
      createdAt: message.createdAt,
    })),
  });

  const created = createAgentRun(ctx, {
    agentId,
    meetingId,
    input: prompt,
    action: 'custom',
    runnerType: 'session',
  });

  // executeRun 在内部更新 run 状态（running→completed/failed）；用执行后的
  // 最新 run 返回，调用方才能看到最终状态。
  const { run } = await executeSessionRun(ctx, created.id, {
    writeBackToMeetingId: meetingId,
    timeout: options?.timeout,
  });

  return { run, executed: true };
}
