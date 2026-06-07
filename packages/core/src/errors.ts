export type MesaErrorCode =
  | 'TASK_NOT_FOUND'
  | 'MEETING_NOT_FOUND'
  | 'ARTIFACT_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ALREADY_EXISTS'
  | 'LOCK_ERROR'
  | 'POLICY_DENIED'
  | 'VALIDATION_ERROR'
  | 'STORAGE_ERROR';

export class MesaError extends Error {
  readonly code: MesaErrorCode;

  constructor(code: MesaErrorCode, message: string) {
    super(message);
    this.name = 'MesaError';
    this.code = code;
  }
}

export class TaskNotFoundError extends MesaError {
  constructor(taskId: string) {
    super('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class MeetingNotFoundError extends MesaError {
  constructor(meetingId: string) {
    super('MEETING_NOT_FOUND', `Meeting not found: ${meetingId}`);
    this.name = 'MeetingNotFoundError';
  }
}

export class ArtifactNotFoundError extends MesaError {
  constructor(artifactId: string) {
    super('ARTIFACT_NOT_FOUND', `Artifact not found: ${artifactId}`);
    this.name = 'ArtifactNotFoundError';
  }
}

export class AgentNotFoundError extends MesaError {
  constructor(agentId: string) {
    super('AGENT_NOT_FOUND', `Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

export class InvalidStatusTransitionError extends MesaError {
  constructor(from: string, to: string) {
    super('INVALID_STATUS_TRANSITION', `Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class WorkspaceNotFoundError extends MesaError {
  constructor(rootDir: string) {
    super('WORKSPACE_NOT_FOUND', `AgentMesa workspace not found in: ${rootDir}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class WorkspaceAlreadyExistsError extends MesaError {
  constructor(rootDir: string) {
    super('WORKSPACE_ALREADY_EXISTS', `AgentMesa workspace already exists in: ${rootDir}`);
    this.name = 'WorkspaceAlreadyExistsError';
  }
}

export class LockError extends MesaError {
  constructor(resource: string, reason: string) {
    super('LOCK_ERROR', `Lock error on "${resource}": ${reason}`);
    this.name = 'LockError';
  }
}

export class ValidationError extends MesaError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class PolicyDeniedError extends MesaError {
  constructor(action: string, resource: string, reason?: string) {
    super(
      'POLICY_DENIED',
      `Policy denied "${action}" on "${resource}"${reason ? `: ${reason}` : ''}`
    );
    this.name = 'PolicyDeniedError';
  }
}
