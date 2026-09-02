import { z } from 'zod';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { agentRoleSchema } from '@agentmesa/protocol';
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
  selfRegisterAgent,
  actorRefOf,
  PRIVILEGED_REGISTRATION_ROLES,
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
  getAgent,
  getArtifact,
  explainTask,
  explainMeeting,
  runAllDiagnostics,
  assertPolicy,
  MesaError,
  REMOTE_WORKSPACE_ID,
} from '@agentmesa/core';
import { toolError, invalidValueError } from './tool-errors.js';
import {
  executeRun,
  activateSessionAgent,
  resolveDriverRegistryFromEnv,
  resolveSessionDriverPreference,
  shouldUseSessionDriver,
  attachPermissionResponder,
} from '@agentmesa/runner';
import type { DiagnosticFinding, MesaActor } from '@agentmesa/core';
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
  MesaRoom,
  MesaAgent,
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
  senderRole: agentRoleSchema.optional(),
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

// --- Remote member registration (M3 Broad Access) ---

export const registerRemoteMemberInputSchema = {
  id: z.string().min(1),
  name: z.string().min(1),
  roles: z.array(agentRoleSchema).optional(),
  endpoint: z.string().optional(),
  roomId: z.string().optional(),
};

export const listAgentsInputSchema = {};

// --- Closed value sets (error guidance) ---
//
// The protocol package does not export the individual enum schemas, so the
// legal values are mirrored here to give failing calls actionable guidance
// ("Use one of: …") instead of a deep Zod parse error. Keep in sync with
// packages/protocol/src/schemas.ts.

const TASK_STATUSES = [
  'backlog', 'ready', 'todo', 'in_progress', 'in_review', 'needs_fix',
  'approved', 'completed', 'done', 'blocked', 'failed', 'cancelled',
  'conflict', 'needs_user_decision', 'reviewing', 'changes_requested',
  'ready_for_review',
] as const;

const MESSAGE_TYPES = [
  'task_created', 'handoff', 'review_request', 'review_result',
  'fix_request', 'fix_done', 'test_result', 'decision', 'status_changed',
  'task_assignment', 'status_update', 'review_feedback',
  'implementation_summary', 'question', 'answer', 'general',
] as const;

const ARTIFACT_KINDS = [
  'implementation_summary', 'review_report', 'fix_summary', 'test_result',
  'test_results', 'git_diff', 'patch', 'decision_record', 'pr_summary',
  'agent_run_log', 'custom',
] as const;

const ARTIFACT_FORMATS = ['markdown', 'json', 'diff', 'text'] as const;

const REVIEW_VERDICTS = ['approved', 'changes_requested', 'rejected'] as const;

const RUN_ACTIONS = [
  'implement', 'review', 'fix', 'test', 'document', 'plan', 'custom',
] as const;

const RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;

const CHECK_KINDS = ['test', 'lint', 'typecheck', 'security', 'custom'] as const;

const CHECK_STATUSES = ['passed', 'failed', 'error', 'skipped'] as const;

const EVENT_TYPES = [
  'task_created', 'task_status_changed', 'task_assigned', 'task_deleted',
  'task_archived', 'meeting_created', 'meeting_status_changed',
  'meeting_trust_level_changed', 'meeting_task_added', 'meeting_agent_added',
  'meeting_agent_removed',
  'agent_joined', 'agent_left', 'agent_registered', 'message_sent',
  'artifact_created', 'decision_made', 'agent_run_created',
  'agent_run_status_changed', 'agent_run_progress', 'agent_run_completed',
  'agent_run_failed', 'agent_run_cancelled', 'workflow_waiting_approval',
  'workflow_approved', 'workflow_rejected', 'check_completed',
  'thread_created', 'thread_resolved',
] as const;

const AGENT_ROLE_VALUES = agentRoleSchema.options;

/**
 * Guard for enum-cast parameters: rejects values outside the closed set with
 * the full legal list, instead of letting them fail (or silently filter to
 * nothing) deep inside core services.
 */
function assertEnumParam(param: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw invalidValueError(param, value, allowed);
  }
}

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
  assertEnumParam('status', args.status, TASK_STATUSES);
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
  assertEnumParam('type', args.type, MESSAGE_TYPES);
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
  assertEnumParam('verdict', args.verdict, REVIEW_VERDICTS);
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
  assertEnumParam('kind', args.kind, ARTIFACT_KINDS);
  if (args.format !== undefined) {
    assertEnumParam('format', args.format, ARTIFACT_FORMATS);
  }
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
  if (args.kind !== undefined) {
    assertEnumParam('kind', args.kind, ARTIFACT_KINDS);
  }
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
  // Reject unknown task ids up front: an empty result for a non-existent task
  // is indistinguishable from "no messages yet" and silently misleads callers.
  if (args.taskId !== undefined) {
    getTask(ctx, args.taskId);
  }
  const messages = args.taskId
    ? getMessagesByTask(ctx, args.taskId)
    : listMessages(ctx);
  return JSON.stringify(messages);
}

export function handleCreateMeeting(
  ctx: MesaRuntimeContext,
  args: { title: string; tasks?: string[]; agents?: string[] }
): string {
  // Ghost references would be stored silently (the same failure class as
  // ghost mentions): validate every task/agent id before creating the meeting.
  for (const taskId of args.tasks ?? []) {
    getTask(ctx, taskId);
  }
  for (const agentId of args.agents ?? []) {
    getAgent(ctx, agentId);
  }
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
  // Single source of truth lives in core (`actorRefOf`).
  return actorRefOf(ctx.actor.id);
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
  const store = roomStore();
  // Pre-check the room and the sender so failures carry the actual values and
  // a concrete fix (the store's own checks remain as the authoritative guard).
  const room = store.getRoom(args.roomId);
  if (args.fromRef !== actorRef) {
    throw toolError(
      'permission_denied',
      `fromRef "${args.fromRef}" does not match the connected actor "${ctx.actor.id}" — impersonation rejected.`,
      `Speak as yourself: set fromRef to "${actorRef}" (the ref part of your actor id). You cannot post on behalf of another room member.`,
    );
  }
  const fromKey = `${args.workspaceId}|${args.fromKind}|${args.fromRef}`;
  const senderIsMember = room.members.some(
    (member) => `${member.workspaceId}|${member.kind}|${member.ref}` === fromKey,
  );
  if (!senderIsMember) {
    throw toolError(
      'precondition_not_met',
      `Sender (${fromKey}) is not a member of room "${args.roomId}".`,
      `Call mesa_invite_to_room with { roomId: "${args.roomId}", workspaceId: "${args.workspaceId}", kind: "${args.fromKind}", ref: "${args.fromRef}" } first, then retry mesa_send_room_message.`,
    );
  }
  if (args.mentions !== undefined && args.mentions.length > 0) {
    const memberRefs = new Set(room.members.map((member) => member.ref));
    const unknown = args.mentions.filter((ref) => !memberRefs.has(ref));
    if (unknown.length > 0) {
      throw toolError(
        'precondition_not_met',
        `mentions reference non-members of room "${args.roomId}": ${unknown.join(', ')}.`,
        'Mention only refs of current members (see mesa_list_rooms). Invite missing members via mesa_invite_to_room, or drop the unknown mentions.',
      );
    }
  }
  const message = store.sendMessage(
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
  // An unknown roomId must not silently yield [] — it is indistinguishable
  // from an empty room and hides the real problem from the caller.
  const store = roomStore();
  store.getRoom(args.roomId);
  return JSON.stringify(store.listMessages(args.roomId, args.after));
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
    throw toolError(
      'permission_denied',
      `ref "${args.ref}" does not match actor "${ctx.actor.id}" — polling another member's rooms is not allowed.`,
      `Poll your own rooms with ref "${actorRef}" (or "${ctx.actor.id}"). Use mesa_list_rooms to discover rooms and their members.`,
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

/**
 * Privileged roles may only be granted by an owner/admin actor. Used by both
 * registration tools — a builder-level actor (including a self-declared HTTP
 * session before server-side adjudication) must not be able to mint
 * owner/admin/chair/maintainer/system agents.
 */
function assertRegistrableRoles(ctx: MesaRuntimeContext, roles: readonly string[]): void {
  if (roles.some((role) => PRIVILEGED_REGISTRATION_ROLES.has(role))) {
    const canGrant = ctx.actor.roles.some((role) => role === 'owner' || role === 'admin');
    if (!canGrant) {
      throw toolError(
        'permission_denied',
        `registering an agent with privileged roles (${roles.filter((r) => PRIVILEGED_REGISTRATION_ROLES.has(r)).join(', ')})`,
        'privileged roles (owner, admin, chair, maintainer, system) may only be granted by an owner/admin actor — run "mesa agent add <id> <name> <roles...>" as the workspace operator, or reconnect with an owner/admin actor',
      );
    }
  }
}

export function handleRegisterAgent(
  ctx: MesaRuntimeContext,
  args: { id: string; name: string; client: string; roles: string[] }
): string {
  for (const role of args.roles) {
    assertEnumParam('roles', role, AGENT_ROLE_VALUES);
  }
  // Self-registration bootstrap: an actor registering ITS OWN id under
  // non-privileged roles goes through the structural selfRegisterAgent
  // channel — no manage_agents capability needed (that is what lets a
  // read-only downgraded HTTP session bootstrap itself). Anything else is a
  // third-party registration and needs the manage_agents capability.
  if (actorRefOf(args.id) === actorRefOf(ctx.actor.id)) {
    const agent = selfRegisterAgent(ctx, {
      id: args.id,
      name: args.name,
      client: args.client,
      status: 'available',
      roles: args.roles as AgentRole[],
    });
    return JSON.stringify(agent);
  }
  assertPolicy(ctx, 'agent.register', `agent:${args.id}`);
  assertRegistrableRoles(ctx, args.roles);
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

/**
 * mesa_register_remote_member（M3 Broad Access）：把一个远程 agent 注册成
 * room/meeting 成员。
 *
 * 远程 agent 通过 MCP streamable HTTP 接入，没有本地 workspace，因此：
 * - 先注册进本 workspace 的 agent registry（client = "remote"，endpoint 记入
 *   metadata），供展示与路由使用；
 * - 可选直接拉进某个 room：成员三元组固定为
 *   `(REMOTE_WORKSPACE_ID, "agent", id)`，之后该 agent 以
 *   `x-agentmesa-actor-id: agent:<id>` 连上来即可发言（fromRef 防冒充校验
 *   天然成立——actor 归一化 ref 等于成员 ref）。
 */
export function handleRegisterRemoteMember(
  ctx: MesaRuntimeContext,
  args: {
    id: string;
    name: string;
    roles?: AgentRole[];
    endpoint?: string;
    roomId?: string;
  },
): string {
  assertPolicy(ctx, 'agent.register', `agent:${args.id}`);
  const requestedRoles = args.roles && args.roles.length > 0 ? args.roles : ['builder'];
  // Same privileged-role fence as handleRegisterAgent — a builder-level actor
  // must not mint owner/admin remote members either.
  assertRegistrableRoles(ctx, requestedRoles);
  const agent = registerAgent(ctx, {
    id: args.id,
    name: args.name,
    client: 'remote',
    status: 'available',
    roles: requestedRoles,
    ...(args.endpoint ? { metadata: { endpoint: args.endpoint } } : {}),
  });

  let room: MesaRoom | undefined;
  if (args.roomId) {
    assertPolicy(ctx, 'room.invite', `room:${args.roomId}`);
    room = roomStore().invite(args.roomId, {
      workspaceId: REMOTE_WORKSPACE_ID,
      kind: 'agent',
      ref: args.id,
      label: args.name,
      ...(args.roles && args.roles.length > 0 ? { roles: args.roles } : {}),
    });
  }
  return JSON.stringify(room ? { agent, room } : { agent });
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

// --- Why (causal explanation) schemas ---

export const whyTaskInputSchema = {
  taskId: z.string().min(1),
};

export const whyMeetingInputSchema = {
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
  // Ghost task/meeting references would produce an orphaned run; an unknown
  // action would fall through to a deep schema parse error.
  if (args.taskId !== undefined) {
    getTask(ctx, args.taskId);
  }
  if (args.meetingId !== undefined) {
    getMeeting(ctx, args.meetingId);
  }
  if (args.action !== undefined) {
    assertEnumParam('action', args.action, RUN_ACTIONS);
  }
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
  // A typo'd status would otherwise filter to a silent empty list.
  if (args.status !== undefined) {
    assertEnumParam('status', args.status, RUN_STATUSES);
  }
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
  assertEnumParam('status', args.status, RUN_STATUSES);
  const run = updateAgentRunStatus(ctx, args.runId, args.status as RunStatus, {
    output: args.output,
    outputSummary: args.outputSummary,
    error: args.error,
  });
  return JSON.stringify(run);
}

/**
 * Resolve the actor identity under which a run's gated (deep-driver) actions
 * are judged: the run's registered agent and its roles. Falls back to the
 * connection actor when the agent is not registered (fail-closed either way —
 * the policy bridge denies everything without roles).
 */
function runAgentActor(ctx: MesaRuntimeContext, agentId: string): MesaActor {
  try {
    const agent = getAgent(ctx, agentId);
    return {
      id: agentId,
      type: 'agent',
      roles: agent.roles,
      client: agent.client,
    };
  } catch {
    return ctx.actor;
  }
}

export async function handleExecRun(
  ctx: MesaRuntimeContext,
  args: { runId: string; dryRun?: boolean; createArtifacts?: boolean; timeout?: number }
): Promise<string> {
  // Surface the pending-only precondition with the run's actual status and a
  // concrete next step, instead of a bare deep-layer rejection.
  const run = getAgentRun(ctx, args.runId);
  if (run.status !== 'pending') {
    throw toolError(
      'precondition_not_met',
      `Run "${args.runId}" has status "${run.status}"; only pending runs can be executed.`,
      'Create a new run with mesa_create_run, or inspect this one with mesa_read_run.',
    );
  }
  const result = await executeRun(ctx, args.runId, attachPermissionResponder({
    dryRun: args.dryRun,
    createArtifacts: args.createArtifacts,
    timeout: args.timeout,
    // Deep drivers are enabled via the AGENTMESA_DRIVER env switch (unset/auto
    // → registry with CLI fallback; cli → empty registry). The MCP tool schema
    // stays stable — the switch is environmental, not a tool argument.
    driverRegistry: resolveDriverRegistryFromEnv(),
  }, {
    ctx,
    // The gated actions run under the *run's* agent identity, not the MCP
    // connection's actor — the deep driver works for that agent.
    actor: runAgentActor(ctx, run.agentId),
  }));
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
  // Session runs have their own deep-driver switch (`AGENTMESA_SESSION_DRIVER`,
  // default 'cli') so enabling deep drivers for task runs via AGENTMESA_DRIVER
  // never silently changes the meeting-speech transport. Unregistered agent ids
  // conservatively stay on the CLI path.
  const preference = resolveSessionDriverPreference();
  let agent: MesaAgent | undefined;
  try {
    agent = getAgent(ctx, args.agentId);
  } catch {
    agent = undefined;
  }
  const baseOptions = {
    ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
  };
  // Trust posture mirrors the desk invite path: `trusted` meetings drop the
  // speech fence so writes are judged by role capabilities. Note there is no
  // askHuman here — the MCP caller is an agent with no human waiting on
  // approvals, so at the `approval` level gated actions still fail closed.
  let trustLevel: 'approval' | 'trusted' = 'approval';
  try {
    trustLevel = getMeeting(ctx, args.meetingId).trustLevel;
  } catch {
    // Unknown meeting — activateSessionAgent will surface the error; keep
    // the safe default until then.
  }
  const options = agent && shouldUseSessionDriver(preference, agent.client)
    ? attachPermissionResponder({
        ...baseOptions,
        driverRegistry: resolveDriverRegistryFromEnv(),
        driverPreference: preference,
      }, {
        ctx,
        // Gated (deep-driver) actions run under the agent's *registered*
        // identity — its roles and client, not the MCP connection's actor.
        actor: {
          id: args.agentId,
          type: 'agent',
          roles: agent.roles,
          client: agent.client,
        },
        // Speech guard (approval level, the default): meeting-speech turns
        // are read-only for every role (state changes go through task → run
        // → approval). At the `trusted` level the fence is off and writes
        // follow the agent's role capabilities. Blocked patterns and
        // secret-path checks apply at both levels.
        speechGuard: trustLevel !== 'trusted',
      })
    : baseOptions;
  const result = await activateSessionAgent(ctx, args.meetingId, args.agentId, options);
  return JSON.stringify(result);
}

// --- Workflow handlers ---

function assertWorkflowExists(workflowId: string): void {
  if (!listWorkflowDefinitionIds().includes(workflowId)) {
    throw toolError(
      'unknown_id',
      `Unknown workflow definition "${workflowId}".`,
      'Call mesa_list_workflows to list registered workflow IDs, then retry with a valid workflowId.',
    );
  }
}

export function handleListWorkflows(): string {
  return JSON.stringify(listWorkflowDefinitionIds());
}

export function handleReadWorkflow(
  _ctx: MesaRuntimeContext,
  args: { workflowId: string }
): string {
  assertWorkflowExists(args.workflowId);
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
  assertWorkflowExists(args.workflowId);
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
  // Ghost references would write an envelope that routes to nothing — the
  // same failure class as ghost mentions. Validate all three ids up front.
  getTask(ctx, args.taskId);
  getAgentRun(ctx, args.runId);
  getArtifact(ctx, args.artifactId);
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
  assertEnumParam('verdict', args.verdict, REVIEW_VERDICTS);
  getTask(ctx, args.taskId);
  getAgentRun(ctx, args.runId);
  getArtifact(ctx, args.artifactId);
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
  // A typo'd type would otherwise filter to a silent empty list.
  if (args.type !== undefined) {
    assertEnumParam('type', args.type, EVENT_TYPES);
  }
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
  // Unknown ids must not silently yield [] — that is indistinguishable from
  // "no events yet" and hides the real problem from the caller.
  getTask(ctx, args.taskId);
  return JSON.stringify(getTaskEvents(ctx, args.taskId));
}

export function handleGetMeetingEvents(
  ctx: MesaRuntimeContext,
  args: { meetingId: string }
): string {
  getMeeting(ctx, args.meetingId);
  return JSON.stringify(getMeetingEvents(ctx, args.meetingId));
}

export function handleWhyTask(
  ctx: MesaRuntimeContext,
  args: { taskId: string }
): string {
  // Unknown ids must fail loudly — a causal explanation of a phantom task
  // would fabricate a "deleted/unknown" blocker out of thin air.
  getTask(ctx, args.taskId);
  return JSON.stringify(explainTask(ctx, args.taskId));
}

export function handleWhyMeeting(
  ctx: MesaRuntimeContext,
  args: { meetingId: string }
): string {
  getMeeting(ctx, args.meetingId);
  return JSON.stringify(explainMeeting(ctx, args.meetingId));
}

export function handleGetTaskProjection(
  ctx: MesaRuntimeContext,
  args: { taskId: string }
): string {
  // Distinguish "projection not built yet" (legitimately null for an existing
  // task) from a non-existent task id, which used to return a silent null.
  getTask(ctx, args.taskId);
  return JSON.stringify(getTaskProjection(ctx, args.taskId, { strict: false }));
}

export function handleGetMeetingProjection(
  ctx: MesaRuntimeContext,
  args: { meetingId: string }
): string {
  getMeeting(ctx, args.meetingId);
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
  // A ghost taskId would silently record a check that belongs to no task.
  getTask(ctx, args.taskId);
  assertEnumParam('status', args.status, CHECK_STATUSES);
  if (args.kind !== undefined) {
    assertEnumParam('kind', args.kind, CHECK_KINDS);
  }
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
  // Typo'd filter values would otherwise silently filter to an empty list.
  if (args.kind !== undefined) {
    assertEnumParam('kind', args.kind, CHECK_KINDS);
  }
  if (args.status !== undefined) {
    assertEnumParam('status', args.status, CHECK_STATUSES);
  }
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

/**
 * Wrap `gh` CLI failures: the connector throws plain Errors whose message
 * alone gives an agent no repair path. Typed MesaErrors pass through so they
 * keep their code-specific translation.
 */
function rethrowConnectorError(tool: string, error: unknown): never {
  if (error instanceof MesaError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  throw toolError(
    'precondition_not_met',
    `${tool} failed: ${message}`,
    'Ensure the `gh` CLI is installed and authenticated (`gh auth status`), and that the current working directory is a Git repository with a GitHub remote, then retry.',
  );
}

export async function handleLinkPr(
  ctx: MesaRuntimeContext,
  args: { taskId: string; prNumber: number }
): Promise<string> {
  try {
    await linkPrToTask(ctx.paths, args.taskId, args.prNumber);
  } catch (error) {
    rethrowConnectorError('mesa_link_pr', error);
  }
  return JSON.stringify({ linked: true, taskId: args.taskId, prNumber: args.prNumber });
}

export async function handleImportCiResults(
  ctx: MesaRuntimeContext,
  args: { taskId: string; agentId: string }
): Promise<string> {
  let result: Awaited<ReturnType<typeof importCIResults>>;
  try {
    result = await importCIResults(ctx.paths, args.taskId, args.agentId, ctx.paths.rootDir);
  } catch (error) {
    rethrowConnectorError('mesa_import_ci_results', error);
  }
  return JSON.stringify(result);
}

// --- Ops / diagnostics tools (read-only) ---

export const doctorInputSchema = {};

export const getEventsInputSchema = {
  streamId: z.string().optional(),
  type: z.string().optional(),
  limit: z.number().int().min(1).optional(),
};

const DEFAULT_EVENTS_LIMIT = 50;
const MAX_EVENTS_LIMIT = 500;
const DATA_SUMMARY_MAX_LENGTH = 200;

/**
 * mesa_doctor: run the full diagnostics suite (event log validity, projection
 * consistency, transport envelopes, agent run consistency, orphaned locks) and
 * return a summary plus findings grouped by severity. Strictly read-only —
 * the fixable findings tell the operator to run `mesa rebuild` / `mesa doctor
 * --fix` on the CLI; this tool never applies any fix itself.
 */
export function handleDoctor(ctx: MesaRuntimeContext): string {
  const findings = runAllDiagnostics(ctx);
  const byLevel: Record<DiagnosticFinding['level'], DiagnosticFinding[]> = {
    error: [],
    warn: [],
    ok: [],
  };
  for (const finding of findings) {
    byLevel[finding.level].push(finding);
  }
  return JSON.stringify({
    summary: {
      total: findings.length,
      ok: byLevel.ok.length,
      warn: byLevel.warn.length,
      error: byLevel.error.length,
    },
    // Severity first: a caller scanning the top of the response sees the
    // actionable findings before the all-clear ones.
    findings: {
      error: byLevel.error,
      warn: byLevel.warn,
      ok: byLevel.ok,
    },
  });
}

/**
 * mesa_get_events: bounded, compact view over the event stream for
 * operational inspection. Unlike mesa_list_events (full event objects,
 * unbounded) this returns the most recent `limit` events as one-line
 * summaries plus a total count, so a large workspace cannot blow up the
 * caller's context.
 */
export function handleGetEvents(
  ctx: MesaRuntimeContext,
  args: { streamId?: string; type?: string; limit?: number }
): string {
  // A typo'd type would otherwise filter to a silent empty list.
  if (args.type !== undefined) {
    assertEnumParam('type', args.type, EVENT_TYPES);
  }
  // Clamp instead of reject: an over-large limit expresses a paging intent,
  // not a caller error — the effective limit is echoed back in the response.
  const limit = Math.min(args.limit ?? DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT);
  const matching = listEvents(ctx, {
    streamId: args.streamId,
    type: args.type as MesaEvent['type'] | undefined,
  });
  // Tail window: operational queries care about what happened lately; the
  // head of a long stream is rarely the interesting part.
  const events = matching.slice(-limit);
  return JSON.stringify({
    total: matching.length,
    returned: events.length,
    limit,
    truncated: matching.length > events.length,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor,
      timestamp: event.timestamp,
      streamId: event.streamId,
      streamType: event.streamType,
      sequence: event.sequence,
      dataSummary: summarizeEventData(event.data),
    })),
  });
}

/** Compact one-line event payload summary; empty string for payload-less events. */
function summarizeEventData(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return '';
  const json = JSON.stringify(data);
  return json.length > DATA_SUMMARY_MAX_LENGTH
    ? `${json.slice(0, DATA_SUMMARY_MAX_LENGTH)}…`
    : json;
}
