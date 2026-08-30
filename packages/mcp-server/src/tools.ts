import { z } from 'zod';
import type { MesaRuntimeContext } from '@agentmesa/core';
import {
  createTask,
  createRuntimeContext,
  getTask,
  listTasks,
  updateTaskStatus,
  appendMessage,
  listMessages,
  getMessagesByTask,
  createArtifact,
  listArtifacts,
  createMeeting,
  listMeetings,
  registerAgent,
  listAgents,
  createAgentRun,
  getAgentRun,
  listAgentRuns,
  updateAgentRunStatus,
  writeReviewRequest,
  writeReviewResult,
  listOutboundHandoffs,
  listInboundHandoffs,
  listEvents,
  getTaskEvents,
  getMeetingEvents,
  getTaskProjection,
  getMeetingProjection,
  createCheckResult,
  getCheckResult,
  listCheckResults,
  createRoomStore,
  getWorkspace,
  getMeeting,
  assertPolicy,
  MesaError,
} from '@agentmesa/core';
import { executeRun, activateSessionAgent } from '@agentmesa/runner';
import {
  WorkflowEngine,
  getWorkflowDefinition,
  listWorkflowDefinitionIds,
} from '@agentmesa/orchestrator';
import { linkPrToTask, importCIResults } from '@agentmesa/connector-github';
import type {
  TaskStatus,
  ArtifactKind,
  AgentRole,
  RunAction,
  RunStatus,
  MesaEvent,
  CheckKind,
  CheckResultStatus,
} from '@agentmesa/protocol';

// --- Input schemas for MCP tool registration ---

export const createTaskInputSchema = {
  title: z.string().min(1),
  createdBy: z.string().min(1),
  assignedTo: z.string().optional(),
  reviewer: z.string().optional(),
  meetingId: z.string().optional(),
  branch: z.string().optional(),
  goal: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
};

export const listTasksInputSchema = {};

export const readTaskInputSchema = {
  taskId: z.string().min(1),
};

export const updateStatusInputSchema = {
  taskId: z.string().min(1),
  status: z.string().min(1),
  updatedBy: z.string().optional(),
};

export const postMessageInputSchema = {
  taskId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().optional(),
  type: z.string().min(1),
  summary: z.string().min(1),
  artifactIds: z.array(z.string()).optional(),
};

export const requestReviewInputSchema = {
  taskId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().optional(),
  summary: z.string().min(1),
  artifactIds: z.array(z.string()).optional(),
};

export const submitReviewInputSchema = {
  taskId: z.string().min(1),
  from: z.string().min(1),
  summary: z.string().min(1),
  verdict: z.string().min(1),
  artifactIds: z.array(z.string()).optional(),
};

export const attachArtifactInputSchema = {
  kind: z.string().min(1),
  taskId: z.string().optional(),
  createdBy: z.string().min(1),
  content: z.string(),
  format: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const listArtifactsInputSchema = {
  taskId: z.string().optional(),
  kind: z.string().optional(),
};

export const listMessagesInputSchema = {
  taskId: z.string().optional(),
};

export const createMeetingInputSchema = {
  title: z.string().min(1),
  tasks: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
};

export const listMeetingsInputSchema = {};

// --- Room tools ---

export const createRoomInputSchema = {
  name: z.string().min(1),
};

export const listRoomsInputSchema = {};

export const inviteToRoomInputSchema = {
  roomId: z.string().min(1),
  workspaceId: z.string().min(1),
  kind: z.enum(['session', 'agent', 'human']),
  ref: z.string().min(1),
  label: z.string().optional(),
};

export const leaveRoomInputSchema = {
  roomId: z.string().min(1),
  workspaceId: z.string().min(1),
  kind: z.enum(['session', 'agent', 'human']),
  ref: z.string().min(1),
};

export const sendRoomMessageInputSchema = {
  roomId: z.string().min(1),
  workspaceId: z.string().min(1),
  fromKind: z.enum(['session', 'agent', 'human']),
  fromRef: z.string().min(1),
  fromLabel: z.string().optional(),
  summary: z.string().min(1),
  type: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  senderRole: z.string().optional(),
  origin: z.enum(['human', 'agent']).optional(),
  body: z.string().optional(),
  taskId: z.string().optional(),
};

export const listRoomMessagesInputSchema = {
  roomId: z.string().min(1),
  after: z.string().optional(),
};

export const pollRoomsInputSchema = {
  ref: z.string().min(1),
  cursors: z.record(z.string(), z.string()).optional(),
};

export const registerAgentInputSchema = {
  id: z.string().min(1),
  name: z.string().min(1),
  client: z.string().min(1),
  roles: z.array(z.string()).min(1),
};

export const listAgentsInputSchema = {};

// --- Handler functions ---

export function handleCreateTask(
  ctx: MesaRuntimeContext,
  args: {
    title: string;
    createdBy: string;
    assignedTo?: string;
    reviewer?: string;
    meetingId?: string;
    branch?: string;
    goal?: string;
    changedFiles?: string[];
    commands?: string[];
  }
): string {
  const context =
    args.goal || args.changedFiles || args.commands
      ? {
          goal: args.goal,
          changedFiles: args.changedFiles,
          commands: args.commands,
        }
      : undefined;

  const task = createTask(ctx, {
    title: args.title,
    assignedTo: args.assignedTo,
    reviewer: args.reviewer,
    meetingId: args.meetingId,
    branch: args.branch,
    context,
  });

  return JSON.stringify(task);
}

export function handleListTasks(ctx: MesaRuntimeContext): string {
  const tasks = listTasks(ctx);
  return JSON.stringify(tasks);
}

export function handleReadTask(ctx: MesaRuntimeContext, args: { taskId: string }): string {
  const task = getTask(ctx, args.taskId);
  return JSON.stringify(task);
}

export function handleUpdateStatus(
  ctx: MesaRuntimeContext,
  args: { taskId: string; status: string; updatedBy?: string }
): string {
  const task = updateTaskStatus(ctx, args.taskId, args.status as TaskStatus);
  return JSON.stringify(task);
}

export function handlePostMessage(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    from: string;
    to?: string;
    type: string;
    summary: string;
    artifactIds?: string[];
  }
): string {
  const message = appendMessage(ctx, {
    taskId: args.taskId,
    to: args.to,
    type: args.type as 'task_created' | 'handoff' | 'review_request' | 'review_result' | 'fix_request' | 'fix_done' | 'test_result' | 'decision' | 'status_changed',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });
  return JSON.stringify(message);
}

export function handleRequestReview(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    from: string;
    to?: string;
    summary: string;
    artifactIds?: string[];
  }
): string {
  // Post a review_request message
  const message = appendMessage(ctx, {
    taskId: args.taskId,
    to: args.to,
    type: 'review_request',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });

  // Update task status to ready_for_review
  const task = updateTaskStatus(ctx, args.taskId, 'ready_for_review');

  return JSON.stringify({ message, task });
}

export function handleSubmitReview(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    from: string;
    summary: string;
    verdict: string;
    artifactIds?: string[];
  }
): string {
  // Post a review_result message
  const message = appendMessage(ctx, {
    taskId: args.taskId,
    type: 'review_result',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });

  // Determine next status based on verdict
  const nextStatus: TaskStatus =
    args.verdict === 'approved' ? 'approved' : 'changes_requested';

  const task = updateTaskStatus(ctx, args.taskId, nextStatus);

  return JSON.stringify({ message, task });
}

export function handleAttachArtifact(
  ctx: MesaRuntimeContext,
  args: {
    kind: string;
    taskId?: string;
    createdBy: string;
    content: string;
    format?: string;
    metadata?: Record<string, unknown>;
  }
): string {
  const artifact = createArtifact(ctx, {
    kind: args.kind as ArtifactKind,
    taskId: args.taskId,
    content: args.content,
    format: args.format as 'markdown' | 'json' | 'diff' | 'text' | undefined,
    metadata: args.metadata,
  });
  return JSON.stringify(artifact);
}

export function handleListArtifacts(
  ctx: MesaRuntimeContext,
  args: { taskId?: string; kind?: string }
): string {
  const artifacts = listArtifacts(
    ctx,
    args.taskId,
    args.kind as ArtifactKind | undefined
  );
  return JSON.stringify(artifacts);
}

export function handleListMessages(
  ctx: MesaRuntimeContext,
  args: { taskId?: string }
): string {
  const messages = args.taskId
    ? getMessagesByTask(ctx, args.taskId)
    : listMessages(ctx);
  return JSON.stringify(messages);
}

export function handleCreateMeeting(
  ctx: MesaRuntimeContext,
  args: { title: string; tasks?: string[]; agents?: string[] }
): string {
  const meeting = createMeeting(ctx, {
    title: args.title,
    tasks: args.tasks,
    agents: args.agents,
  });
  return JSON.stringify(meeting);
}

export function handleListMeetings(ctx: MesaRuntimeContext): string {
  const meetings = listMeetings(ctx);
  return JSON.stringify(meetings);
}

// --- Room handlers ---

function roomStore() {
  return createRoomStore();
}

/**
 * 从 ctx.actor.id 归一化出成员 ref：actor id 形如 "agent:codex"，而房间成员
 * ref 是 "codex"。取第一个冒号后的部分；不含冒号的裸 id（如 "user"）原样返回。
 */
function actorRefFor(ctx: MesaRuntimeContext): string {
  const id = ctx.actor.id;
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
}

function resolveMemberLabel(
  ctx: MesaRuntimeContext,
  workspaceId: string,
  kind: 'session' | 'agent' | 'human',
  ref: string,
): string | undefined {
  if (kind === 'human') return '我';
  try {
    if (kind === 'session') {
      const workspace = getWorkspace(workspaceId);
      const targetCtx = workspace
        ? createRuntimeContext({
            rootDir: workspace.rootDir,
            actor: { id: 'system:mcp', type: 'system', roles: ['read_only'] },
          })
        : ctx;
      return getMeeting(targetCtx, ref).title;
    }
    const workspace = getWorkspace(workspaceId);
    const targetCtx = workspace
      ? createRuntimeContext({
          rootDir: workspace.rootDir,
          actor: { id: 'system:mcp', type: 'system', roles: ['read_only'] },
        })
      : ctx;
    return listAgents(targetCtx).find((agent) => agent.id === ref)?.name;
  } catch {
    return undefined;
  }
}

export function handleCreateRoom(
  ctx: MesaRuntimeContext,
  args: { name: string },
): string {
  assertPolicy(ctx, 'room.create', 'room');
  const room = roomStore().createRoom({ name: args.name });
  return JSON.stringify(room);
}

export function handleListRooms(_ctx: MesaRuntimeContext): string {
  return JSON.stringify(roomStore().listRooms());
}

export function handleInviteToRoom(
  ctx: MesaRuntimeContext,
  args: {
    roomId: string;
    workspaceId: string;
    kind: 'session' | 'agent' | 'human';
    ref: string;
    label?: string;
  },
): string {
  const label = args.label ?? resolveMemberLabel(ctx, args.workspaceId, args.kind, args.ref);
  assertPolicy(ctx, 'room.invite', `room:${args.roomId}`);
  const room = roomStore().invite(args.roomId, {
    workspaceId: args.workspaceId,
    kind: args.kind,
    ref: args.ref,
    ...(label ? { label } : {}),
  });
  return JSON.stringify(room);
}

export function handleLeaveRoom(
  ctx: MesaRuntimeContext,
  args: { roomId: string; workspaceId: string; kind: 'session' | 'agent' | 'human'; ref: string },
): string {
  assertPolicy(ctx, 'room.leave', `room:${args.roomId}`);
  const room = roomStore().leave(args.roomId, {
    workspaceId: args.workspaceId,
    kind: args.kind,
    ref: args.ref,
  });
  return JSON.stringify(room);
}

export function handleSendRoomMessage(
  ctx: MesaRuntimeContext,
  args: {
    roomId: string;
    workspaceId: string;
    fromKind: 'session' | 'agent' | 'human';
    fromRef: string;
    fromLabel?: string;
    summary: string;
    type?: string;
    mentions?: string[];
    senderRole?: string;
    origin?: 'human' | 'agent';
    body?: string;
    taskId?: string;
  },
): string {
  assertPolicy(ctx, 'room.message.append', `room:${args.roomId}`);
  // 防冒充：fromRef 必须与 MCP actor 一致（"agent:codex" → "codex"），
  // 由 room store 的 actorRef 校验兜底拒绝。
  const actorRef = actorRefFor(ctx);
  const message = roomStore().sendMessage(
    args.roomId,
    {
      workspaceId: args.workspaceId,
      from: {
        workspaceId: args.workspaceId,
        kind: args.fromKind,
        ref: args.fromRef,
        ...(args.fromLabel ? { label: args.fromLabel } : {}),
      },
      summary: args.summary,
      ...(args.type ? { type: args.type } : {}),
      ...(args.mentions ? { mentions: args.mentions } : {}),
      ...(args.senderRole ? { senderRole: args.senderRole } : {}),
      ...(args.origin ? { origin: args.origin } : {}),
      ...(args.body ? { body: args.body } : {}),
      ...(args.taskId ? { taskId: args.taskId } : {}),
    },
    { actorRef },
  );
  return JSON.stringify(message);
}

export function handleListRoomMessages(
  _ctx: MesaRuntimeContext,
  args: { roomId: string; after?: string },
): string {
  // 只读：list 免策略检查。
  return JSON.stringify(roomStore().listMessages(args.roomId, args.after));
}

/**
 * mesa_poll_rooms：按成员 ref 反查其所有房间，返回增量新消息与最新游标。
 * - cursors[roomId] 传入时：返回该房间游标之后的新消息；
 * - 未传游标：只返回房间摘要 + 最新一条消息。
 * cursor 恒为该房间最后一条消息 id，调用方下次带上即可续读。
 */
export function handlePollRooms(
  ctx: MesaRuntimeContext,
  args: { ref: string; cursors?: Record<string, string> },
): string {
  // 只读，但只能轮询自己：ref 必须与 actor 匹配（归一化或全等），防止窥探他人房间。
  const actorRef = actorRefFor(ctx);
  if (args.ref !== actorRef && args.ref !== ctx.actor.id) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `ref "${args.ref}" does not match actor "${ctx.actor.id}" — polling another member's rooms is not allowed.`,
    );
  }
  const store = roomStore();
  const rooms = store
    .listRoomsForMember(args.ref)
    .map(({ room, lastMessageAt }) => {
      const after = args.cursors?.[room.id];
      const all = store.listMessages(room.id);
      const latest = all.at(-1) ?? null;
      const messages = after === undefined ? (latest ? [latest] : []) : store.listMessages(room.id, after);
      return {
        roomId: room.id,
        name: room.name,
        purpose: room.purpose,
        memberCount: room.members.length,
        lastMessageAt,
        cursor: latest?.id ?? null,
        messages,
      };
    });
  return JSON.stringify({ ref: args.ref, rooms });
}

export function handleRegisterAgent(
  ctx: MesaRuntimeContext,
  args: { id: string; name: string; client: string; roles: string[] }
): string {
  const agent = registerAgent(ctx, {
    id: args.id,
    name: args.name,
    client: args.client,
    status: 'available',
    roles: args.roles as AgentRole[],
  });
  return JSON.stringify(agent);
}

export function handleListAgents(ctx: MesaRuntimeContext): string {
  const agents = listAgents(ctx);
  return JSON.stringify(agents);
}

// --- Agent run schemas ---

export const createRunInputSchema = {
  agentId: z.string().min(1),
  input: z.string().min(1),
  taskId: z.string().optional(),
  meetingId: z.string().optional(),
  action: z.string().optional(),
  runnerType: z.string().optional(),
};

export const listRunsInputSchema = {
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  status: z.string().optional(),
};

export const readRunInputSchema = {
  runId: z.string().min(1),
};

export const updateRunStatusInputSchema = {
  runId: z.string().min(1),
  status: z.string().min(1),
  output: z.string().optional(),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
};

export const execRunInputSchema = {
  runId: z.string().min(1),
  dryRun: z.boolean().optional(),
  createArtifacts: z.boolean().optional(),
  timeout: z.number().optional(),
};

export const activateSessionAgentInputSchema = {
  meetingId: z.string().min(1),
  agentId: z.string().min(1),
  timeout: z.number().optional(),
};

// --- Workflow schemas ---

export const listWorkflowsInputSchema = {};

export const readWorkflowInputSchema = {
  workflowId: z.string().min(1),
};

export const runWorkflowInputSchema = {
  workflowId: z.string().min(1),
  taskId: z.string().min(1),
  maxSteps: z.number().optional(),
};

// --- Handoff schemas ---

export const requestHandoffInputSchema = {
  taskId: z.string().min(1),
  runId: z.string().min(1),
  artifactId: z.string().min(1),
  requestedReviewer: z.string().min(1),
  summary: z.string().min(1),
};

export const submitHandoffResultInputSchema = {
  taskId: z.string().min(1),
  runId: z.string().min(1),
  artifactId: z.string().min(1),
  reviewer: z.string().min(1),
  summary: z.string().min(1),
  verdict: z.string().min(1),
  detail: z.string().optional(),
};

export const listHandoffsInputSchema = {};

// --- Event / projection schemas ---

export const listEventsInputSchema = {
  streamId: z.string().optional(),
  meetingId: z.string().optional(),
  type: z.string().optional(),
};

export const getTaskEventsInputSchema = {
  taskId: z.string().min(1),
};

export const getMeetingEventsInputSchema = {
  meetingId: z.string().min(1),
};

export const getTaskProjectionInputSchema = {
  taskId: z.string().min(1),
};

export const getMeetingProjectionInputSchema = {
  meetingId: z.string().min(1),
};

// --- Check result schemas ---

export const createCheckInputSchema = {
  taskId: z.string().min(1),
  runId: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().min(1),
  checkName: z.string().min(1),
  exitCode: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  duration: z.number().optional(),
  success: z.boolean(),
  summary: z.string().optional(),
  detail: z.string().optional(),
};

export const listChecksInputSchema = {
  taskId: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
};

export const getCheckInputSchema = {
  checkId: z.string().min(1),
};

// --- GitHub connector schemas ---

export const linkPrInputSchema = {
  taskId: z.string().min(1),
  prNumber: z.number().int(),
};

export const importCiResultsInputSchema = {
  taskId: z.string().min(1),
  agentId: z.string().min(1),
};

// --- Agent run handlers ---

export function handleCreateRun(
  ctx: MesaRuntimeContext,
  args: {
    agentId: string;
    input: string;
    taskId?: string;
    meetingId?: string;
    action?: string;
    runnerType?: string;
  }
): string {
  const run = createAgentRun(ctx, {
    agentId: args.agentId,
    input: args.input,
    taskId: args.taskId,
    meetingId: args.meetingId,
    action: (args.action as RunAction | undefined) ?? 'implement',
    runnerType: args.runnerType,
  });
  return JSON.stringify(run);
}

export function handleListRuns(
  ctx: MesaRuntimeContext,
  args: { taskId?: string; agentId?: string; status?: string }
): string {
  const runs = listAgentRuns(ctx, {
    taskId: args.taskId,
    agentId: args.agentId,
    status: args.status as RunStatus | undefined,
  });
  return JSON.stringify(runs);
}

export function handleReadRun(ctx: MesaRuntimeContext, args: { runId: string }): string {
  const run = getAgentRun(ctx, args.runId);
  return JSON.stringify(run);
}

export function handleUpdateRunStatus(
  ctx: MesaRuntimeContext,
  args: {
    runId: string;
    status: string;
    output?: string;
    outputSummary?: string;
    error?: string;
  }
): string {
  const run = updateAgentRunStatus(ctx, args.runId, args.status as RunStatus, {
    output: args.output,
    outputSummary: args.outputSummary,
    error: args.error,
  });
  return JSON.stringify(run);
}

export async function handleExecRun(
  ctx: MesaRuntimeContext,
  args: { runId: string; dryRun?: boolean; createArtifacts?: boolean; timeout?: number }
): Promise<string> {
  const result = await executeRun(ctx, args.runId, {
    dryRun: args.dryRun,
    createArtifacts: args.createArtifacts,
    timeout: args.timeout,
  });
  return JSON.stringify(result);
}

/**
 * Activate a session agent: ensure the agent joins the meeting and drive a
 * `session` run so the real CLI agent participates. Awaits the run to
 * completion so the caller (an AI client) can act on the agent's reply; the
 * run's output is written back into the session timeline.
 */
export async function handleActivateSessionAgent(
  ctx: MesaRuntimeContext,
  args: { meetingId: string; agentId: string; timeout?: number }
): Promise<string> {
  const result = await activateSessionAgent(ctx, args.meetingId, args.agentId, {
    ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
  });
  return JSON.stringify(result);
}

// --- Workflow handlers ---

export function handleListWorkflows(): string {
  return JSON.stringify(listWorkflowDefinitionIds());
}

export function handleReadWorkflow(
  _ctx: MesaRuntimeContext,
  args: { workflowId: string }
): string {
  const def = getWorkflowDefinition(args.workflowId);
  return JSON.stringify({
    id: def.id,
    name: def.name,
    description: def.description,
    startStep: def.startStep,
    steps: def.steps.map((s) => ({ id: s.id, type: s.type, description: s.description })),
  });
}

export async function handleRunWorkflow(
  ctx: MesaRuntimeContext,
  args: { workflowId: string; taskId: string; maxSteps?: number }
): Promise<string> {
  const def = getWorkflowDefinition(args.workflowId);
  const engine = new WorkflowEngine(ctx);
  const initial = engine.startWorkflow(def, args.taskId);
  const final = await engine.advanceWorkflow(
    initial,
    args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : undefined
  );
  return JSON.stringify(final);
}

// --- Handoff handlers ---

export function handleRequestHandoff(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    runId: string;
    artifactId: string;
    requestedReviewer: string;
    summary: string;
  }
): string {
  const envelope = writeReviewRequest(ctx, {
    taskId: args.taskId,
    runId: args.runId,
    artifactId: args.artifactId,
    requestedReviewer: args.requestedReviewer,
    summary: args.summary,
  });
  return JSON.stringify(envelope);
}

export function handleSubmitHandoffResult(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    runId: string;
    artifactId: string;
    reviewer: string;
    summary: string;
    verdict: string;
    detail?: string;
  }
): string {
  const envelope = writeReviewResult(ctx, {
    taskId: args.taskId,
    runId: args.runId,
    artifactId: args.artifactId,
    reviewer: args.reviewer,
    summary: args.summary,
    verdict: args.verdict as 'approved' | 'changes_requested' | 'rejected',
    detail: args.detail,
  });
  return JSON.stringify(envelope);
}

export function handleListHandoffs(ctx: MesaRuntimeContext): string {
  return JSON.stringify({
    outbound: listOutboundHandoffs(ctx),
    inbound: listInboundHandoffs(ctx),
  });
}

// --- Event / projection handlers ---

export function handleListEvents(
  ctx: MesaRuntimeContext,
  args: { streamId?: string; meetingId?: string; type?: string }
): string {
  const events = listEvents(ctx, {
    streamId: args.streamId,
    meetingId: args.meetingId,
    type: args.type as MesaEvent['type'] | undefined,
  });
  return JSON.stringify(events);
}

export function handleGetTaskEvents(
  ctx: MesaRuntimeContext,
  args: { taskId: string }
): string {
  return JSON.stringify(getTaskEvents(ctx, args.taskId));
}

export function handleGetMeetingEvents(
  ctx: MesaRuntimeContext,
  args: { meetingId: string }
): string {
  return JSON.stringify(getMeetingEvents(ctx, args.meetingId));
}

export function handleGetTaskProjection(
  ctx: MesaRuntimeContext,
  args: { taskId: string }
): string {
  return JSON.stringify(getTaskProjection(ctx, args.taskId, { strict: false }));
}

export function handleGetMeetingProjection(
  ctx: MesaRuntimeContext,
  args: { meetingId: string }
): string {
  return JSON.stringify(getMeetingProjection(ctx, args.meetingId, { strict: false }));
}

// --- Check result handlers ---

export function handleCreateCheck(
  ctx: MesaRuntimeContext,
  args: {
    taskId: string;
    runId?: string;
    kind?: string;
    status: string;
    checkName: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    duration?: number;
    success: boolean;
    summary?: string;
    detail?: string;
  }
): string {
  const check = createCheckResult(ctx, {
    taskId: args.taskId,
    runId: args.runId,
    kind: args.kind as CheckKind | undefined,
    status: args.status as CheckResultStatus,
    checkName: args.checkName,
    exitCode: args.exitCode,
    stdout: args.stdout,
    stderr: args.stderr,
    duration: args.duration,
    success: args.success,
    summary: args.summary,
    detail: args.detail,
  });
  return JSON.stringify(check);
}

export function handleListChecks(
  ctx: MesaRuntimeContext,
  args: { taskId?: string; kind?: string; status?: string }
): string {
  const checks = listCheckResults(ctx, {
    taskId: args.taskId,
    kind: args.kind as CheckKind | undefined,
    status: args.status as CheckResultStatus | undefined,
  });
  return JSON.stringify(checks);
}

export function handleGetCheck(ctx: MesaRuntimeContext, args: { checkId: string }): string {
  return JSON.stringify(getCheckResult(ctx, args.checkId));
}

// --- GitHub connector handlers ---

export async function handleLinkPr(
  ctx: MesaRuntimeContext,
  args: { taskId: string; prNumber: number }
): Promise<string> {
  await linkPrToTask(ctx.paths, args.taskId, args.prNumber);
  return JSON.stringify({ linked: true, taskId: args.taskId, prNumber: args.prNumber });
}

export async function handleImportCiResults(
  ctx: MesaRuntimeContext,
  args: { taskId: string; agentId: string }
): Promise<string> {
  const result = await importCIResults(ctx.paths, args.taskId, args.agentId, ctx.paths.rootDir);
  return JSON.stringify(result);
}
