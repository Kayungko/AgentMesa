import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { currentProtocolVersion } from '@agentmesa/protocol';
import { createRuntimeContext, createWorkspacePaths } from '@agentmesa/core';
import type {
  MesaRuntimeContext,
  MesaWorkspacePaths,
} from '@agentmesa/core';
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
} from './tools.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapHandler<T extends Record<string, any>>(
  paths: MesaWorkspacePaths,
  handler: (paths: MesaWorkspacePaths, args: T) => string
) {
  return async (args: T) => {
    try {
      const result = handler(paths, args);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

function wrapNoArgHandler(
  paths: MesaWorkspacePaths,
  handler: (paths: MesaWorkspacePaths) => string
) {
  return async () => {
    try {
      const result = handler(paths);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapRuntimeHandler<T extends Record<string, any>>(
  rootDir: string,
  actorId: (args: T) => string,
  handler: (ctx: MesaRuntimeContext, args: T) => string
) {
  return async (args: T) => {
    try {
      const ctx = createAgentRuntimeContext(rootDir, actorId(args));
      const result = handler(ctx, args);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

function wrapRuntimeNoArgHandler(
  rootDir: string,
  handler: (ctx: MesaRuntimeContext) => string
) {
  return async () => {
    try {
      const result = handler(createAgentRuntimeContext(rootDir, 'agent:mcp'));
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
}

function createAgentRuntimeContext(
  rootDir: string,
  actorId: string
): MesaRuntimeContext {
  return createRuntimeContext({
    rootDir,
    actor: {
      id: actorId,
      type: 'agent',
      roles: ['custom'],
      client: 'mcp',
    },
  });
}

export function createMcpServer(rootDir: string): McpServer {
  const paths = createWorkspacePaths(rootDir);

  const server = new McpServer({
    name: 'agentmesa',
    version: currentProtocolVersion,
  });

  // Task tools
  server.registerTool('mesa_create_task', {
    description: 'Create a new AgentMesa task',
    inputSchema: createTaskInputSchema,
  }, wrapRuntimeHandler(rootDir, (args) => args.createdBy, handleCreateTask));

  server.registerTool('mesa_list_tasks', {
    description: 'List all AgentMesa tasks',
    inputSchema: listTasksInputSchema,
  }, wrapRuntimeNoArgHandler(rootDir, handleListTasks));

  server.registerTool('mesa_read_task', {
    description: 'Read a specific AgentMesa task by ID',
    inputSchema: readTaskInputSchema,
  }, wrapRuntimeHandler(rootDir, () => 'agent:mcp', handleReadTask));

  server.registerTool('mesa_update_status', {
    description: 'Update the status of an AgentMesa task',
    inputSchema: updateStatusInputSchema,
  }, wrapRuntimeHandler(
    rootDir,
    (args) => args.updatedBy ?? 'agent:mcp',
    handleUpdateStatus
  ));

  // Message tools
  server.registerTool('mesa_post_message', {
    description: 'Post a message to an AgentMesa task',
    inputSchema: postMessageInputSchema,
  }, wrapHandler(paths, handlePostMessage));

  server.registerTool('mesa_request_review', {
    description: 'Request a review for a task, sets status to ready_for_review',
    inputSchema: requestReviewInputSchema,
  }, wrapRuntimeHandler(rootDir, (args) => args.from, handleRequestReview));

  server.registerTool('mesa_submit_review', {
    description: 'Submit a review result for a task, updates status to approved or changes_requested',
    inputSchema: submitReviewInputSchema,
  }, wrapRuntimeHandler(rootDir, (args) => args.from, handleSubmitReview));

  server.registerTool('mesa_list_messages', {
    description: 'List messages, optionally filtered by task ID',
    inputSchema: listMessagesInputSchema,
  }, wrapHandler(paths, handleListMessages));

  // Artifact tools
  server.registerTool('mesa_attach_artifact', {
    description: 'Attach an artifact to an AgentMesa task',
    inputSchema: attachArtifactInputSchema,
  }, wrapHandler(paths, handleAttachArtifact));

  server.registerTool('mesa_list_artifacts', {
    description: 'List artifacts, optionally filtered by task ID or kind',
    inputSchema: listArtifactsInputSchema,
  }, wrapHandler(paths, handleListArtifacts));

  // Meeting tools
  server.registerTool('mesa_create_meeting', {
    description: 'Create a new AgentMesa meeting',
    inputSchema: createMeetingInputSchema,
  }, wrapHandler(paths, handleCreateMeeting));

  server.registerTool('mesa_list_meetings', {
    description: 'List all AgentMesa meetings',
    inputSchema: listMeetingsInputSchema,
  }, wrapNoArgHandler(paths, handleListMeetings));

  // Agent tools
  server.registerTool('mesa_register_agent', {
    description: 'Register an AI agent in AgentMesa',
    inputSchema: registerAgentInputSchema,
  }, wrapHandler(paths, handleRegisterAgent));

  server.registerTool('mesa_list_agents', {
    description: 'List all registered AgentMesa agents',
    inputSchema: listAgentsInputSchema,
  }, wrapNoArgHandler(paths, handleListAgents));

  return server;
}

export async function startServer(rootDir: string): Promise<void> {
  const server = createMcpServer(rootDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
