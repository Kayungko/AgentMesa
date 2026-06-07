import { z } from 'zod';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import {
  createTask,
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
} from '@agentmesa/core';
import type { TaskStatus, ArtifactKind, AgentRole } from '@agentmesa/protocol';

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

export const registerAgentInputSchema = {
  id: z.string().min(1),
  name: z.string().min(1),
  client: z.string().min(1),
  roles: z.array(z.string()).min(1),
};

export const listAgentsInputSchema = {};

// --- Handler functions ---

export function handleCreateTask(
  paths: MesaWorkspacePaths,
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

  const task = createTask(paths, {
    title: args.title,
    createdBy: args.createdBy,
    assignedTo: args.assignedTo,
    reviewer: args.reviewer,
    meetingId: args.meetingId,
    branch: args.branch,
    context,
  });

  return JSON.stringify(task);
}

export function handleListTasks(paths: MesaWorkspacePaths): string {
  const tasks = listTasks(paths);
  return JSON.stringify(tasks);
}

export function handleReadTask(paths: MesaWorkspacePaths, args: { taskId: string }): string {
  const task = getTask(paths, args.taskId);
  return JSON.stringify(task);
}

export function handleUpdateStatus(
  paths: MesaWorkspacePaths,
  args: { taskId: string; status: string; updatedBy?: string }
): string {
  const task = updateTaskStatus(
    paths,
    args.taskId,
    args.status as TaskStatus,
    args.updatedBy
  );
  return JSON.stringify(task);
}

export function handlePostMessage(
  paths: MesaWorkspacePaths,
  args: {
    taskId: string;
    from: string;
    to?: string;
    type: string;
    summary: string;
    artifactIds?: string[];
  }
): string {
  const message = appendMessage(paths, {
    taskId: args.taskId,
    from: args.from,
    to: args.to,
    type: args.type as 'task_created' | 'handoff' | 'review_request' | 'review_result' | 'fix_request' | 'fix_done' | 'test_result' | 'decision' | 'status_changed',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });
  return JSON.stringify(message);
}

export function handleRequestReview(
  paths: MesaWorkspacePaths,
  args: {
    taskId: string;
    from: string;
    to?: string;
    summary: string;
    artifactIds?: string[];
  }
): string {
  // Post a review_request message
  const message = appendMessage(paths, {
    taskId: args.taskId,
    from: args.from,
    to: args.to,
    type: 'review_request',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });

  // Update task status to ready_for_review
  const task = updateTaskStatus(paths, args.taskId, 'ready_for_review', args.from);

  return JSON.stringify({ message, task });
}

export function handleSubmitReview(
  paths: MesaWorkspacePaths,
  args: {
    taskId: string;
    from: string;
    summary: string;
    verdict: string;
    artifactIds?: string[];
  }
): string {
  // Post a review_result message
  const message = appendMessage(paths, {
    taskId: args.taskId,
    from: args.from,
    type: 'review_result',
    summary: args.summary,
    artifactIds: args.artifactIds,
  });

  // Determine next status based on verdict
  const nextStatus: TaskStatus =
    args.verdict === 'approved' ? 'approved' : 'changes_requested';

  const task = updateTaskStatus(paths, args.taskId, nextStatus, args.from);

  return JSON.stringify({ message, task });
}

export function handleAttachArtifact(
  paths: MesaWorkspacePaths,
  args: {
    kind: string;
    taskId?: string;
    createdBy: string;
    content: string;
    format?: string;
    metadata?: Record<string, unknown>;
  }
): string {
  const artifact = createArtifact(paths, {
    kind: args.kind as ArtifactKind,
    taskId: args.taskId,
    createdBy: args.createdBy,
    content: args.content,
    format: args.format as 'markdown' | 'json' | 'diff' | 'text' | undefined,
    metadata: args.metadata,
  });
  return JSON.stringify(artifact);
}

export function handleListArtifacts(
  paths: MesaWorkspacePaths,
  args: { taskId?: string; kind?: string }
): string {
  const artifacts = listArtifacts(
    paths,
    args.taskId,
    args.kind as ArtifactKind | undefined
  );
  return JSON.stringify(artifacts);
}

export function handleListMessages(
  paths: MesaWorkspacePaths,
  args: { taskId?: string }
): string {
  const messages = args.taskId
    ? getMessagesByTask(paths, args.taskId)
    : listMessages(paths);
  return JSON.stringify(messages);
}

export function handleCreateMeeting(
  paths: MesaWorkspacePaths,
  args: { title: string; tasks?: string[]; agents?: string[] }
): string {
  const meeting = createMeeting(paths, {
    title: args.title,
    tasks: args.tasks,
    agents: args.agents,
  });
  return JSON.stringify(meeting);
}

export function handleListMeetings(paths: MesaWorkspacePaths): string {
  const meetings = listMeetings(paths);
  return JSON.stringify(meetings);
}

export function handleRegisterAgent(
  paths: MesaWorkspacePaths,
  args: { id: string; name: string; client: string; roles: string[] }
): string {
  const agent = registerAgent(paths, {
    id: args.id,
    name: args.name,
    client: args.client,
    status: 'available',
    roles: args.roles as AgentRole[],
  });
  return JSON.stringify(agent);
}

export function handleListAgents(paths: MesaWorkspacePaths): string {
  const agents = listAgents(paths);
  return JSON.stringify(agents);
}
