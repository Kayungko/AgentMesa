import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { currentProtocolVersion } from '@agentmesa/protocol';
import { createRuntimeContext, getWorkspace } from '@agentmesa/core';
import type { MesaActor, MesaRuntimeContext } from '@agentmesa/core';
import {
  createTaskInputSchema,
  listTasksInputSchema,
  readTaskInputSchema,
  updateStatusInputSchema,
  postMessageInputSchema,
  requestReviewInputSchema,
  submitReviewInputSchema,
  attachArtifactInputSchema,
  listArtifactsInputSchema,
  listMessagesInputSchema,
  createMeetingInputSchema,
  listMeetingsInputSchema,
  registerAgentInputSchema,
  listAgentsInputSchema,
  createRunInputSchema,
  listRunsInputSchema,
  readRunInputSchema,
  updateRunStatusInputSchema,
  execRunInputSchema,
  activateSessionAgentInputSchema,
  listWorkflowsInputSchema,
  readWorkflowInputSchema,
  runWorkflowInputSchema,
  requestHandoffInputSchema,
  submitHandoffResultInputSchema,
  listHandoffsInputSchema,
  listEventsInputSchema,
  getTaskEventsInputSchema,
  getMeetingEventsInputSchema,
  getTaskProjectionInputSchema,
  getMeetingProjectionInputSchema,
  createCheckInputSchema,
  listChecksInputSchema,
  getCheckInputSchema,
  linkPrInputSchema,
  importCiResultsInputSchema,
  createRoomInputSchema,
  listRoomsInputSchema,
  inviteToRoomInputSchema,
  leaveRoomInputSchema,
  sendRoomMessageInputSchema,
  listRoomMessagesInputSchema,
  handleCreateRoom,
  handleListRooms,
  handleInviteToRoom,
  handleLeaveRoom,
  handleSendRoomMessage,
  handleListRoomMessages,
  handleCreateTask,
  handleListTasks,
  handleReadTask,
  handleUpdateStatus,
  handlePostMessage,
  handleRequestReview,
  handleSubmitReview,
  handleAttachArtifact,
  handleListArtifacts,
  handleListMessages,
  handleCreateMeeting,
  handleListMeetings,
  handleRegisterAgent,
  handleListAgents,
  handleCreateRun,
  handleListRuns,
  handleReadRun,
  handleUpdateRunStatus,
  handleExecRun,
  handleActivateSessionAgent,
  handleListWorkflows,
  handleReadWorkflow,
  handleRunWorkflow,
  handleRequestHandoff,
  handleSubmitHandoffResult,
  handleListHandoffs,
  handleListEvents,
  handleGetTaskEvents,
  handleGetMeetingEvents,
  handleGetTaskProjection,
  handleGetMeetingProjection,
  handleCreateCheck,
  handleListChecks,
  handleGetCheck,
  handleLinkPr,
  handleImportCiResults,
} from './tools.js';

/**
 * Resolve the MCP server's actor identity from the environment. The id and
 * roles are operator-configured, not taken from client tool arguments — a
 * connected AI client cannot escalate its own privileges. `builder` is the
 * least-privilege default that still carries `manage_runs` / `manage_tasks`.
 */
export function resolveActor(): MesaActor {
  const id = process.env.AGENTMESA_MCP_ACTOR_ID?.trim() || 'agent:mcp';
  const roles = (process.env.AGENTMESA_MCP_ACTOR_ROLES?.trim() || 'builder')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean) as MesaActor['roles'];
  return { id, type: 'agent', roles, client: 'mcp' };
}

function createMcpContextFactory(rootDir: string): (args?: Record<string, unknown>) => MesaRuntimeContext {
  const actor = resolveActor();
  return (args) => {
    // A per-call `workspaceId` lets a tool operate on another workspace's
    // data (used by room tools); absent that, fall back to the server root.
    const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId : undefined;
    const targetRoot = workspaceId ? getWorkspace(workspaceId)?.rootDir ?? rootDir : rootDir;
    return createRuntimeContext({ rootDir: targetRoot, actor });
  };
}

type ContextFactory = (args?: Record<string, unknown>) => MesaRuntimeContext;

function errorEnvelope(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapRuntimeHandler<T extends Record<string, any>>(
  makeCtx: ContextFactory,
  handler: (ctx: MesaRuntimeContext, args: T) => string
) {
  return async (args: T) => {
    try {
      return { content: [{ type: 'text' as const, text: handler(makeCtx(args), args) }] };
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapAsyncRuntimeHandler<T extends Record<string, any>>(
  makeCtx: ContextFactory,
  handler: (ctx: MesaRuntimeContext, args: T) => Promise<string>
) {
  return async (args: T) => {
    try {
      return { content: [{ type: 'text' as const, text: await handler(makeCtx(args), args) }] };
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}

function wrapRuntimeNoArgHandler(
  makeCtx: ContextFactory,
  handler: (ctx: MesaRuntimeContext) => string
) {
  return async () => {
    try {
      return { content: [{ type: 'text' as const, text: handler(makeCtx()) }] };
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}

function wrapNoCtxHandler(handler: () => string) {
  return async () => {
    try {
      return { content: [{ type: 'text' as const, text: handler() }] };
    } catch (error) {
      return errorEnvelope(error);
    }
  };
}

export function createMcpServer(rootDir: string): McpServer {
  const server = new McpServer({
    name: 'agentmesa',
    version: currentProtocolVersion,
  });

  const makeCtx = createMcpContextFactory(rootDir);

  // Task tools
  server.registerTool('mesa_create_task', {
    description: 'Create a new AgentMesa task',
    inputSchema: createTaskInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleCreateTask));

  server.registerTool('mesa_list_tasks', {
    description: 'List all AgentMesa tasks',
    inputSchema: listTasksInputSchema,
  }, wrapRuntimeNoArgHandler(makeCtx, handleListTasks));

  server.registerTool('mesa_read_task', {
    description: 'Read a specific AgentMesa task by ID',
    inputSchema: readTaskInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleReadTask));

  server.registerTool('mesa_update_status', {
    description: 'Update the status of an AgentMesa task',
    inputSchema: updateStatusInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleUpdateStatus));

  // Message tools
  server.registerTool('mesa_post_message', {
    description: 'Post a message to an AgentMesa task',
    inputSchema: postMessageInputSchema,
  }, wrapRuntimeHandler(makeCtx, handlePostMessage));

  server.registerTool('mesa_request_review', {
    description: 'Request a review for a task, sets status to ready_for_review',
    inputSchema: requestReviewInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleRequestReview));

  server.registerTool('mesa_submit_review', {
    description: 'Submit a review result for a task, updates status to approved or changes_requested',
    inputSchema: submitReviewInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleSubmitReview));

  server.registerTool('mesa_list_messages', {
    description: 'List messages, optionally filtered by task ID',
    inputSchema: listMessagesInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListMessages));

  // Artifact tools
  server.registerTool('mesa_attach_artifact', {
    description: 'Attach an artifact to an AgentMesa task',
    inputSchema: attachArtifactInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleAttachArtifact));

  server.registerTool('mesa_list_artifacts', {
    description: 'List artifacts, optionally filtered by task ID or kind',
    inputSchema: listArtifactsInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListArtifacts));

  // Meeting tools
  server.registerTool('mesa_create_meeting', {
    description: 'Create a new AgentMesa meeting',
    inputSchema: createMeetingInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleCreateMeeting));

  server.registerTool('mesa_list_meetings', {
    description: 'List all AgentMesa meetings',
    inputSchema: listMeetingsInputSchema,
  }, wrapRuntimeNoArgHandler(makeCtx, handleListMeetings));

  // Agent tools
  server.registerTool('mesa_register_agent', {
    description: 'Register an AI agent in AgentMesa',
    inputSchema: registerAgentInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleRegisterAgent));

  server.registerTool('mesa_list_agents', {
    description: 'List all registered AgentMesa agents',
    inputSchema: listAgentsInputSchema,
  }, wrapRuntimeNoArgHandler(makeCtx, handleListAgents));

  // Agent run tools
  server.registerTool('mesa_create_run', {
    description: 'Create a new AgentMesa agent run (pending status)',
    inputSchema: createRunInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleCreateRun));

  server.registerTool('mesa_list_runs', {
    description: 'List agent runs, optionally filtered by task, agent, or status',
    inputSchema: listRunsInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListRuns));

  server.registerTool('mesa_read_run', {
    description: 'Read a specific agent run by ID',
    inputSchema: readRunInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleReadRun));

  server.registerTool('mesa_update_run_status', {
    description: 'Update an agent run status (optionally attach output/error)',
    inputSchema: updateRunStatusInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleUpdateRunStatus));

  server.registerTool('mesa_exec_run', {
    description: 'Execute a pending agent run through its runner backend (drives the real CLI when configured)',
    inputSchema: execRunInputSchema,
  }, wrapAsyncRuntimeHandler(makeCtx, handleExecRun));

  server.registerTool('mesa_activate_session_agent', {
    description: 'Invite a registered agent into a session and drive the real CLI agent to participate — the agent replies are written back into the session timeline',
    inputSchema: activateSessionAgentInputSchema,
  }, wrapAsyncRuntimeHandler(makeCtx, handleActivateSessionAgent));

  // Workflow tools
  server.registerTool('mesa_list_workflows', {
    description: 'List registered workflow definition IDs',
    inputSchema: listWorkflowsInputSchema,
  }, wrapNoCtxHandler(handleListWorkflows));

  server.registerTool('mesa_read_workflow', {
    description: 'Read a workflow definition by ID',
    inputSchema: readWorkflowInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleReadWorkflow));

  server.registerTool('mesa_run_workflow', {
    description: 'Start and advance a workflow for a task, returning the final workflow state',
    inputSchema: runWorkflowInputSchema,
  }, wrapAsyncRuntimeHandler(makeCtx, handleRunWorkflow));

  // Handoff tools
  server.registerTool('mesa_request_handoff', {
    description: 'Write a review_request handoff envelope to the outbox',
    inputSchema: requestHandoffInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleRequestHandoff));

  server.registerTool('mesa_submit_handoff_result', {
    description: 'Write a review_result handoff envelope to the inbox',
    inputSchema: submitHandoffResultInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleSubmitHandoffResult));

  server.registerTool('mesa_list_handoffs', {
    description: 'List inbound and outbound handoff envelopes',
    inputSchema: listHandoffsInputSchema,
  }, wrapRuntimeNoArgHandler(makeCtx, handleListHandoffs));

  // Event / projection tools
  server.registerTool('mesa_list_events', {
    description: 'List events, optionally filtered by stream, meeting, or type',
    inputSchema: listEventsInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListEvents));

  server.registerTool('mesa_get_task_events', {
    description: 'List events for a specific task stream',
    inputSchema: getTaskEventsInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleGetTaskEvents));

  server.registerTool('mesa_get_meeting_events', {
    description: 'List all events for a meeting across every stream',
    inputSchema: getMeetingEventsInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleGetMeetingEvents));

  server.registerTool('mesa_get_task_projection', {
    description: 'Read the current projection (read model) for a task',
    inputSchema: getTaskProjectionInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleGetTaskProjection));

  server.registerTool('mesa_get_meeting_projection', {
    description: 'Read the current projection (read model) for a meeting',
    inputSchema: getMeetingProjectionInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleGetMeetingProjection));

  // Check result tools
  server.registerTool('mesa_create_check', {
    description: 'Record a MesaCheckResult (test/lint/typecheck/security/custom) for a task',
    inputSchema: createCheckInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleCreateCheck));

  server.registerTool('mesa_list_checks', {
    description: 'List check results, optionally filtered by task, kind, or status',
    inputSchema: listChecksInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListChecks));

  server.registerTool('mesa_get_check', {
    description: 'Read a specific check result by ID',
    inputSchema: getCheckInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleGetCheck));

  // GitHub connector tools (shell out to the real `gh` CLI)
  server.registerTool('mesa_link_pr', {
    description: 'Link a GitHub pull request to a task (stores a pr_summary artifact)',
    inputSchema: linkPrInputSchema,
  }, wrapAsyncRuntimeHandler(makeCtx, handleLinkPr));

  server.registerTool('mesa_import_ci_results', {
    description: 'Import GitHub Actions CI status for the current repo via `gh run list`, recording a MesaCheckResult per finished run',
    inputSchema: importCiResultsInputSchema,
  }, wrapAsyncRuntimeHandler(makeCtx, handleImportCiResults));

  // Room tools (global, cross-workspace group chat)
  server.registerTool('mesa_create_room', {
    description: 'Create a new cross-workspace Room (group chat)',
    inputSchema: createRoomInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleCreateRoom));

  server.registerTool('mesa_list_rooms', {
    description: 'List all Rooms',
    inputSchema: listRoomsInputSchema,
  }, wrapRuntimeNoArgHandler(makeCtx, handleListRooms));

  server.registerTool('mesa_invite_to_room', {
    description: 'Invite a session or agent from a workspace into a Room',
    inputSchema: inviteToRoomInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleInviteToRoom));

  server.registerTool('mesa_leave_room', {
    description: 'Remove a session or agent from a Room',
    inputSchema: leaveRoomInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleLeaveRoom));

  server.registerTool('mesa_send_room_message', {
    description: 'Post a message into a Room (cross-workspace)',
    inputSchema: sendRoomMessageInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleSendRoomMessage));

  server.registerTool('mesa_list_room_messages', {
    description: 'List messages in a Room',
    inputSchema: listRoomMessagesInputSchema,
  }, wrapRuntimeHandler(makeCtx, handleListRoomMessages));

  return server;
}

export async function startServer(rootDir: string): Promise<void> {
  const server = createMcpServer(rootDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
