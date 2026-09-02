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
  registerRemoteMemberInputSchema,
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
  whyTaskInputSchema,
  whyMeetingInputSchema,
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
  pollRoomsInputSchema,
  doctorInputSchema,
  getEventsInputSchema,
  handleDoctor,
  handleGetEvents,
  handleCreateRoom,
  handleListRooms,
  handleInviteToRoom,
  handleLeaveRoom,
  handleSendRoomMessage,
  handleListRoomMessages,
  handlePollRooms,
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
  handleRegisterRemoteMember,
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
  handleWhyTask,
  handleWhyMeeting,
  handleCreateCheck,
  handleListChecks,
  handleGetCheck,
  handleLinkPr,
  handleImportCiResults,
} from './tools.js';
import { toolErrorResult } from './tool-errors.js';

/**
 * Resolve the MCP server's actor identity from the environment. The id and
 * roles are operator-configured, not taken from client tool arguments — a
 * connected AI client cannot escalate its own privileges. `builder` is the
 * least-privilege default that still carries `manage_runs` / `manage_tasks`.
 *
 * This is the stdio model: one process, one operator-pinned actor. HTTP
 * connections must NOT use it — they pass an explicit per-connection actor
 * to `createMcpServer` instead (see http-server.ts).
 */
export function resolveActor(): MesaActor {
  const id = process.env.AGENTMESA_MCP_ACTOR_ID?.trim() || 'agent:mcp';
  const roles = (process.env.AGENTMESA_MCP_ACTOR_ROLES?.trim() || 'builder')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean) as MesaActor['roles'];
  return { id, type: 'agent', roles, client: 'mcp' };
}

export interface McpServerOptions {
  /**
   * Explicit actor bound to this server instance. When omitted (stdio mode)
   * the actor is resolved from the environment via `resolveActor()`. HTTP
   * sessions always pass a connection-scoped actor — never the shared
   * env-derived one.
   */
  actor?: MesaActor;
}

function createMcpContextFactory(
  rootDir: string,
  actor: MesaActor,
): (args?: Record<string, unknown>) => MesaRuntimeContext {
  return (args) => {
    // A per-call `workspaceId` lets a tool operate on another workspace's
    // data (used by room tools); absent that, fall back to the server root.
    const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId : undefined;
    const targetRoot = workspaceId ? getWorkspace(workspaceId)?.rootDir ?? rootDir : rootDir;
    return createRuntimeContext({ rootDir: targetRoot, actor });
  };
}

type ContextFactory = (args?: Record<string, unknown>) => MesaRuntimeContext;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = { description: string; inputSchema: Record<string, any> };

/**
 * Register a `mesa_*` tool under the unified error contract: every failure —
 * whether a structured ToolError thrown by the handler or an error bubbling
 * up from core/runner/connectors — is returned as an `isError` envelope
 * carrying what failed, why, and how to fix it, so an AI caller can repair
 * its arguments and retry on its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerMesaTool(
  server: McpServer,
  name: string,
  def: AnyToolDefinition,
  makeCtx: ContextFactory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: MesaRuntimeContext, args: any) => string | Promise<string>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, def, async (args: any) => {
    try {
      const text = await handler(makeCtx(args), args);
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return toolErrorResult(name, error);
    }
  });
}

export function createMcpServer(rootDir: string, options?: McpServerOptions): McpServer {
  const server = new McpServer({
    name: 'agentmesa',
    version: currentProtocolVersion,
  });

  const makeCtx = createMcpContextFactory(rootDir, options?.actor ?? resolveActor());

  // Every tool goes through registerMesaTool so failures uniformly return the
  // what/why/fix error envelope instead of a bare message string.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const register = (name: string, def: AnyToolDefinition, handler: (ctx: MesaRuntimeContext, args: any) => string | Promise<string>) => {
    registerMesaTool(server, name, def, makeCtx, handler);
  };

  // Task tools
  register('mesa_create_task', {
    description: 'Create a new AgentMesa task',
    inputSchema: createTaskInputSchema,
  }, handleCreateTask);

  register('mesa_list_tasks', {
    description: 'List all AgentMesa tasks',
    inputSchema: listTasksInputSchema,
  }, handleListTasks);

  register('mesa_read_task', {
    description: 'Read a specific AgentMesa task by ID',
    inputSchema: readTaskInputSchema,
  }, handleReadTask);

  register('mesa_update_status', {
    description: 'Update the status of an AgentMesa task',
    inputSchema: updateStatusInputSchema,
  }, handleUpdateStatus);

  // Message tools
  register('mesa_post_message', {
    description: 'Post a message to an AgentMesa task',
    inputSchema: postMessageInputSchema,
  }, handlePostMessage);

  register('mesa_request_review', {
    description: 'Request a review for a task, sets status to ready_for_review',
    inputSchema: requestReviewInputSchema,
  }, handleRequestReview);

  register('mesa_submit_review', {
    description: 'Submit a review result for a task, updates status to approved or changes_requested',
    inputSchema: submitReviewInputSchema,
  }, handleSubmitReview);

  register('mesa_list_messages', {
    description: 'List messages, optionally filtered by task ID',
    inputSchema: listMessagesInputSchema,
  }, handleListMessages);

  // Artifact tools
  register('mesa_attach_artifact', {
    description: 'Attach an artifact to an AgentMesa task',
    inputSchema: attachArtifactInputSchema,
  }, handleAttachArtifact);

  register('mesa_list_artifacts', {
    description: 'List artifacts, optionally filtered by task ID or kind',
    inputSchema: listArtifactsInputSchema,
  }, handleListArtifacts);

  // Meeting tools
  register('mesa_create_meeting', {
    description: 'Create a new AgentMesa meeting',
    inputSchema: createMeetingInputSchema,
  }, handleCreateMeeting);

  register('mesa_list_meetings', {
    description: 'List all AgentMesa meetings',
    inputSchema: listMeetingsInputSchema,
  }, handleListMeetings);

  // Agent tools
  register('mesa_register_agent', {
    description: 'Register an AI agent in AgentMesa',
    inputSchema: registerAgentInputSchema,
  }, handleRegisterAgent);

  register('mesa_list_agents', {
    description: 'List all registered AgentMesa agents',
    inputSchema: listAgentsInputSchema,
  }, handleListAgents);

  // Remote member registration (M3 Broad Access)
  register('mesa_register_remote_member', {
    description: 'Register a remote agent (joined via MCP streamable HTTP) in the agent registry and optionally invite it into a Room as a remote member',
    inputSchema: registerRemoteMemberInputSchema,
  }, handleRegisterRemoteMember);

  // Agent run tools
  register('mesa_create_run', {
    description: 'Create a new AgentMesa agent run (pending status)',
    inputSchema: createRunInputSchema,
  }, handleCreateRun);

  register('mesa_list_runs', {
    description: 'List agent runs, optionally filtered by task, agent, or status',
    inputSchema: listRunsInputSchema,
  }, handleListRuns);

  register('mesa_read_run', {
    description: 'Read a specific agent run by ID',
    inputSchema: readRunInputSchema,
  }, handleReadRun);

  register('mesa_update_run_status', {
    description: 'Update an agent run status (optionally attach output/error)',
    inputSchema: updateRunStatusInputSchema,
  }, handleUpdateRunStatus);

  register('mesa_exec_run', {
    description: 'Execute a pending agent run through its runner backend (drives the real CLI when configured)',
    inputSchema: execRunInputSchema,
  }, handleExecRun);

  register('mesa_activate_session_agent', {
    description: 'Invite a registered agent into a session and drive the real CLI agent to participate — the agent replies are written back into the session timeline',
    inputSchema: activateSessionAgentInputSchema,
  }, handleActivateSessionAgent);

  // Workflow tools
  register('mesa_list_workflows', {
    description: 'List registered workflow definition IDs',
    inputSchema: listWorkflowsInputSchema,
  }, handleListWorkflows);

  register('mesa_read_workflow', {
    description: 'Read a workflow definition by ID',
    inputSchema: readWorkflowInputSchema,
  }, handleReadWorkflow);

  register('mesa_run_workflow', {
    description: 'Start and advance a workflow for a task, returning the final workflow state',
    inputSchema: runWorkflowInputSchema,
  }, handleRunWorkflow);

  // Handoff tools
  register('mesa_request_handoff', {
    description: 'Write a review_request handoff envelope to the outbox',
    inputSchema: requestHandoffInputSchema,
  }, handleRequestHandoff);

  register('mesa_submit_handoff_result', {
    description: 'Write a review_result handoff envelope to the inbox',
    inputSchema: submitHandoffResultInputSchema,
  }, handleSubmitHandoffResult);

  register('mesa_list_handoffs', {
    description: 'List inbound and outbound handoff envelopes',
    inputSchema: listHandoffsInputSchema,
  }, handleListHandoffs);

  // Event / projection tools
  register('mesa_list_events', {
    description: 'List events, optionally filtered by stream, meeting, or type',
    inputSchema: listEventsInputSchema,
  }, handleListEvents);

  register('mesa_get_task_events', {
    description: 'List events for a specific task stream',
    inputSchema: getTaskEventsInputSchema,
  }, handleGetTaskEvents);

  register('mesa_get_meeting_events', {
    description: 'List all events for a meeting across every stream',
    inputSchema: getMeetingEventsInputSchema,
  }, handleGetMeetingEvents);

  register('mesa_why_task', {
    description: 'Explain a task causally: status chain with actors and causes, plus the current blocker (who/what it is waiting on and the evidence)',
    inputSchema: whyTaskInputSchema,
  }, handleWhyTask);

  register('mesa_why_meeting', {
    description: 'Explain a meeting causally: task snapshots, cross-stream timeline, and the current blocker with evidence',
    inputSchema: whyMeetingInputSchema,
  }, handleWhyMeeting);

  register('mesa_get_task_projection', {
    description: 'Read the current projection (read model) for a task',
    inputSchema: getTaskProjectionInputSchema,
  }, handleGetTaskProjection);

  register('mesa_get_meeting_projection', {
    description: 'Read the current projection (read model) for a meeting',
    inputSchema: getMeetingProjectionInputSchema,
  }, handleGetMeetingProjection);

  // Check result tools
  register('mesa_create_check', {
    description: 'Record a MesaCheckResult (test/lint/typecheck/security/custom) for a task',
    inputSchema: createCheckInputSchema,
  }, handleCreateCheck);

  register('mesa_list_checks', {
    description: 'List check results, optionally filtered by task, kind, or status',
    inputSchema: listChecksInputSchema,
  }, handleListChecks);

  register('mesa_get_check', {
    description: 'Read a specific check result by ID',
    inputSchema: getCheckInputSchema,
  }, handleGetCheck);

  // GitHub connector tools (shell out to the real `gh` CLI)
  register('mesa_link_pr', {
    description: 'Link a GitHub pull request to a task (stores a pr_summary artifact)',
    inputSchema: linkPrInputSchema,
  }, handleLinkPr);

  register('mesa_import_ci_results', {
    description: 'Import GitHub Actions CI status for the current repo via `gh run list`, recording a MesaCheckResult per finished run',
    inputSchema: importCiResultsInputSchema,
  }, handleImportCiResults);

  // Room tools (global, cross-workspace group chat)
  register('mesa_create_room', {
    description: 'Create a new cross-workspace Room (group chat)',
    inputSchema: createRoomInputSchema,
  }, handleCreateRoom);

  register('mesa_list_rooms', {
    description: 'List all Rooms',
    inputSchema: listRoomsInputSchema,
  }, handleListRooms);

  register('mesa_invite_to_room', {
    description: 'Invite a session or agent from a workspace into a Room',
    inputSchema: inviteToRoomInputSchema,
  }, handleInviteToRoom);

  register('mesa_leave_room', {
    description: 'Remove a session or agent from a Room',
    inputSchema: leaveRoomInputSchema,
  }, handleLeaveRoom);

  register('mesa_send_room_message', {
    description: 'Post a message into a Room (cross-workspace)',
    inputSchema: sendRoomMessageInputSchema,
  }, handleSendRoomMessage);

  register('mesa_list_room_messages', {
    description: 'List messages in a Room (optionally only those after a message-id cursor)',
    inputSchema: listRoomMessagesInputSchema,
  }, handleListRoomMessages);

  register('mesa_poll_rooms', {
    description: 'Poll all Rooms the calling member belongs to: new messages per room since a cursor (message id), plus each room\'s current cursor. Pass cursors per roomId to read incrementally; omit for a summary plus the latest message.',
    inputSchema: pollRoomsInputSchema,
  }, handlePollRooms);

  // Ops / diagnostics tools (read-only)
  register('mesa_doctor', {
    description: 'Run read-only workspace diagnostics (event log validity, projection consistency, transport envelopes, agent run consistency, orphaned locks) and report a summary plus findings grouped by severity — never modifies any state',
    inputSchema: doctorInputSchema,
  }, handleDoctor);

  register('mesa_get_events', {
    description: 'Query the event stream (read-only): the most recent events as compact summaries (id/type/actor/timestamp/data digest), optionally filtered by stream or event type; limit defaults to 50 and is capped at 500',
    inputSchema: getEventsInputSchema,
  }, handleGetEvents);

  return server;
}

export async function startServer(rootDir: string): Promise<void> {
  const server = createMcpServer(rootDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
