import { describe, it, expect } from 'vitest';
import {
  MesaAgentSchema,
  MesaAgentCapabilitySchema,
  MesaTaskSchema,
  MesaMessageSchema,
  MesaArtifactSchema,
  MesaMeetingSchema,
  MesaThreadSchema,
  MesaDecisionSchema,
  MesaEventSchema,
  MesaClientSchema,
  MesaTransportSchema,
  TransportCapabilitiesSchema,
  MesaAgentRunSchema,
  MesaCheckResultSchema,
  MesaRepositorySchema,
  CreateTaskInputSchema,
  CreateMessageInputSchema,
  CreateMeetingInputSchema,
  CreateThreadInputSchema,
  CreateDecisionInputSchema,
  CreateAgentRunInputSchema,
  eventTypeSchema,
} from '../schemas.js';

// ---------------------------------------------------------------------------
// MesaAgentSchema
// ---------------------------------------------------------------------------
describe('MesaAgentSchema', () => {
  const validAgent = {
    id: 'agent_0001abcd',
    name: 'Claude',
    client: 'claude-code',
    roles: ['builder'] as const,
  };

  it('accepts a valid agent', () => {
    const result = MesaAgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('rejects empty roles', () => {
    const result = MesaAgentSchema.safeParse({ ...validAgent, roles: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = MesaAgentSchema.safeParse({ ...validAgent, roles: ['invalid_role'] });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id, ...rest } = validAgent;
    const result = MesaAgentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts agent with optional fields', () => {
    const result = MesaAgentSchema.safeParse({
      ...validAgent,
      clientId: 'client_abcd1234',
      status: 'busy',
      metadata: { provider: 'anthropic' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('busy');
  });
});

// ---------------------------------------------------------------------------
// MesaAgentCapabilitySchema
// ---------------------------------------------------------------------------
describe('MesaAgentCapabilitySchema', () => {
  it('accepts a valid capability with all fields', () => {
    const result = MesaAgentCapabilitySchema.safeParse({
      agentId: 'agent_0001abcd',
      permissions: ['builder', 'reviewer'],
      supportedTransports: ['file', 'mcp'],
      supportedArtifactKinds: ['implementation_summary', 'git_diff'],
      canReviewCode: true,
      canEditFiles: true,
      canRunShell: true,
      canUseMcp: true,
      canOpenPullRequest: true,
      canReadPullRequest: true,
      canExecuteCommands: ['build', 'test'],
      maxContextTokens: 200_000,
      allowedFilePatterns: ['src/**'],
      deniedFilePatterns: ['.env'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal capability', () => {
    const result = MesaAgentCapabilitySchema.safeParse({
      agentId: 'agent_0001abcd',
      permissions: ['read_only'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canEditFiles).toBe(false);
      expect(result.data.canUseMcp).toBe(false);
    }
  });

  it('rejects empty permissions', () => {
    const result = MesaAgentCapabilitySchema.safeParse({
      agentId: 'agent_0001abcd',
      permissions: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaTaskSchema
// ---------------------------------------------------------------------------
describe('MesaTaskSchema', () => {
  const validTask = {
    id: 'task_a1b2c3d4',
    title: 'Build feature',
    status: 'todo' as const,
    createdBy: 'user',
    meetingId: 'meeting_m1m2m3m4',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid task', () => {
    const result = MesaTaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts task with optional context', () => {
    const result = MesaTaskSchema.safeParse({
      ...validTask,
      status: 'in_progress',
      branch: 'feature/x',
      context: { goal: 'Add login', changedFiles: ['src/auth.ts'], commands: ['npm test'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = MesaTaskSchema.safeParse({ ...validTask, status: 'invalid_status' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = MesaTaskSchema.safeParse({ ...validTask, title: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a task without meetingId (optional since tasks may exist standalone)', () => {
    const { meetingId, ...rest } = validTask;
    const result = MesaTaskSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meetingId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// MesaMessageSchema
// ---------------------------------------------------------------------------
describe('MesaMessageSchema', () => {
  const validMessage = {
    id: 'msg_a1b2c3d4',
    from: 'agent_0001abcd',
    type: 'review_request' as const,
    summary: 'Please review',
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid message', () => {
    const result = MesaMessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts message with new fields: threadId, replyToMessageId, meetingId', () => {
    const result = MesaMessageSchema.safeParse({
      ...validMessage,
      meetingId: 'meeting_m1m2m3m4',
      taskId: 'task_a1b2c3d4',
      threadId: 'thread_t1t2t3t4',
      replyToMessageId: 'msg_prev001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts realtime correlation fields', () => {
    const result = MesaMessageSchema.safeParse({
      ...validMessage,
      correlationId: 'corr_123',
      replyTo: 'request_123',
      causationId: 'event_123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts message with artifact refs', () => {
    const result = MesaMessageSchema.safeParse({
      ...validMessage,
      type: 'review_result',
      artifactIds: ['A-001', 'A-002'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid message type', () => {
    const result = MesaMessageSchema.safeParse({ ...validMessage, type: 'unknown_type' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaArtifactSchema
// ---------------------------------------------------------------------------
describe('MesaArtifactSchema', () => {
  it('accepts a valid artifact', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'review_report',
      taskId: 'task_a1b2c3d4',
      createdBy: 'agent_0001abcd',
      content: '# Review\nLooks good',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts artifact with metadata and tags', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'test_result',
      createdBy: 'agent_0001abcd',
      content: '{"passed": true}',
      mimeType: 'application/json',
      version: 2,
      tags: ['test', 'regression'],
      metadata: { passed: true, total: 42 },
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts artifact with meetingId', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'custom',
      meetingId: 'meeting_m1m2m3m4',
      createdBy: 'agent_0001abcd',
      content: 'test',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid artifact kind', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'invalid_kind',
      createdBy: 'agent_0001abcd',
      content: 'test',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaMeetingSchema
// ---------------------------------------------------------------------------
describe('MesaMeetingSchema', () => {
  it('accepts a valid meeting', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'meeting_m1m2m3m4',
      title: 'Feature Review',
      status: 'active',
      tasks: ['task_a1b2c3d4'],
      agents: ['agent_0001abcd', 'agent_0002abcd'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts meeting with new fields', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'meeting_m1m2m3m4',
      title: 'Planning',
      status: 'planning',
      purpose: 'Plan the architecture refactor',
      workspaceId: 'ws_w1w2w3w4',
      ownerAgentId: 'agent_0001abcd',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-02T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid meeting status', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'meeting_m1m2m3m4',
      title: 'Test',
      status: 'invalid_status_xyz',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('defaults trustLevel to approval when absent (pre-trust-level meeting files)', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'meeting_m1m2m3m4',
      title: 'Legacy',
      status: 'active',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trustLevel).toBe('approval');
    }
  });

  it('accepts trustLevel trusted and rejects invalid values', () => {
    const base = {
      id: 'meeting_m1m2m3m4',
      title: 'Trust',
      status: 'active',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const trusted = MesaMeetingSchema.safeParse({ ...base, trustLevel: 'trusted' });
    expect(trusted.success).toBe(true);
    if (trusted.success) {
      expect(trusted.data.trustLevel).toBe('trusted');
    }
    const invalid = MesaMeetingSchema.safeParse({ ...base, trustLevel: 'trustedX' });
    expect(invalid.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaThreadSchema
// ---------------------------------------------------------------------------
describe('MesaThreadSchema', () => {
  it('accepts a valid thread', () => {
    const result = MesaThreadSchema.safeParse({
      id: 'thread_t1t2t3t4',
      meetingId: 'meeting_m1m2m3m4',
      title: 'Security Review',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resolution).toBe('unresolved');
    }
  });

  it('accepts a resolved thread', () => {
    const result = MesaThreadSchema.safeParse({
      id: 'thread_t1t2t3t4',
      meetingId: 'meeting_m1m2m3m4',
      title: 'Decision log',
      rootMessageId: 'msg_a1b2c3d4',
      resolution: 'resolved',
      createdAt: '2026-01-01T00:00:00Z',
      resolvedAt: '2026-01-02T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing meetingId', () => {
    const result = MesaThreadSchema.safeParse({
      id: 'thread_t1t2t3t4',
      title: 'No meeting',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaDecisionSchema
// ---------------------------------------------------------------------------
describe('MesaDecisionSchema', () => {
  const validDecision = {
    id: 'decision_d1d2d3d4',
    meetingId: 'meeting_m1m2m3m4',
    decidedBy: 'user',
    options: ['Option A', 'Option B'],
    selectedOption: 'Option A',
    rationale: 'Better fit for requirements',
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid decision', () => {
    const result = MesaDecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts decision with task and thread refs', () => {
    const result = MesaDecisionSchema.safeParse({
      ...validDecision,
      taskId: 'task_a1b2c3d4',
      threadId: 'thread_t1t2t3t4',
      title: 'Auth approach decision',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty options', () => {
    const result = MesaDecisionSchema.safeParse({ ...validDecision, options: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty rationale', () => {
    const result = MesaDecisionSchema.safeParse({ ...validDecision, rationale: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaEventSchema
// ---------------------------------------------------------------------------
describe('MesaEventSchema', () => {
  const validEvent = {
    id: 'event_e1e2e3e4',
    meetingId: 'meeting_m1m2m3m4',
    type: 'task_created' as const,
    streamId: 'task_a1b2c3d4',
    streamType: 'MesaTask',
    data: { title: 'New task' },
    actor: 'agent_0001abcd',
    sequence: 1,
    timestamp: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid event', () => {
    const result = MesaEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts event with minimal data', () => {
    const result = MesaEventSchema.safeParse({
      ...validEvent,
      type: 'agent_run_completed',
      streamType: 'MesaAgentRun',
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts runtime context mutation event types', () => {
    const eventTypes = [
      'task_deleted',
      'task_archived',
      'meeting_status_changed',
      'meeting_task_added',
      'meeting_agent_added',
      'meeting_agent_removed',
      'agent_registered',
    ] as const;

    for (const type of eventTypes) {
      const result = MesaEventSchema.safeParse({
        ...validEvent,
        type,
        streamId: `${type}_stream`,
        streamType: 'runtime',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid event type', () => {
    const result = MesaEventSchema.safeParse({ ...validEvent, type: 'invalid_type' });
    expect(result.success).toBe(false);
  });

  // The event vocabulary is the append-only audit contract: once these names are
  // written to disk they can never be rewritten. This locks the frozen set so any
  // addition or rename is a deliberate, reviewed change rather than silent drift.
  it('freezes the event type vocabulary (underscore form)', () => {
    expect(eventTypeSchema.options).toEqual([
      'task_created',
      'task_status_changed',
      'task_assigned',
      'task_deleted',
      'task_archived',
      'meeting_created',
      'meeting_status_changed',
      'meeting_trust_level_changed',
      'meeting_task_added',
      'meeting_agent_added',
      'meeting_agent_removed',
      'agent_joined',
      'agent_left',
      'agent_registered',
      'message_sent',
      'artifact_created',
      'decision_made',
      'agent_run_created',
      'agent_run_status_changed',
      'agent_run_progress',
      'agent_run_completed',
      'agent_run_failed',
      'agent_run_cancelled',
      'workflow_waiting_approval',
      'workflow_approved',
      'workflow_rejected',
      'check_completed',
      'thread_created',
      'thread_resolved',
      'meeting_imported',
    ]);
  });
});

// ---------------------------------------------------------------------------
// MesaClientSchema
// ---------------------------------------------------------------------------
describe('MesaClientSchema', () => {
  it('accepts a valid client', () => {
    const result = MesaClientSchema.safeParse({
      id: 'client_c1c2c3c4',
      name: 'Claude Code',
      type: 'claude-code',
      supportedTransports: ['file', 'mcp'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts client with all fields', () => {
    const result = MesaClientSchema.safeParse({
      id: 'client_c1c2c3c4',
      name: 'Codex',
      type: 'codex',
      supportedTransports: ['file', 'http'],
      version: '2026.01',
      supportedFeatures: ['review', 'test'],
      metadata: { provider: 'openai' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid client type', () => {
    const result = MesaClientSchema.safeParse({
      id: 'client_c1c2c3c4',
      name: 'Unknown',
      type: 'unknown-client',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaTransportSchema
// ---------------------------------------------------------------------------
describe('MesaTransportSchema', () => {
  it('accepts a valid transport', () => {
    const result = MesaTransportSchema.safeParse({
      name: 'MCP Transport',
      type: 'mcp',
      capabilities: { canCreateTasks: true, canReadTasks: true },
      version: '2024-11-05',
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal transport (defaults applied)', () => {
    const result = MesaTransportSchema.safeParse({
      name: 'File Transport',
      type: 'file',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities.canReadTasks).toBe(true);
      expect(result.data.capabilities.canCreateTasks).toBe(false);
    }
  });

  it('rejects invalid transport type', () => {
    const result = MesaTransportSchema.safeParse({
      name: 'Bad',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('TransportCapabilitiesSchema', () => {
  it('all fields default to false except canReadTasks', () => {
    const result = TransportCapabilitiesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canReadTasks).toBe(true);
      expect(result.data.canCreateTasks).toBe(false);
      expect(result.data.supportsPush).toBe(false);
    }
  });

  it('file transport has all write capabilities', () => {
    const result = TransportCapabilitiesSchema.safeParse({
      canCreateTasks: true,
      canReadTasks: true,
      canUpdateTaskStatus: true,
      canPostMessages: true,
      canAttachArtifacts: true,
      canCreateMeetings: true,
      canRegisterAgents: true,
    });
    expect(result.success).toBe(true);
  });

  it('push-only transport (WebSocket) has limited capabilities', () => {
    const result = TransportCapabilitiesSchema.safeParse({
      supportsPush: true,
      supportsBidirectional: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canReadTasks).toBe(true);
      expect(result.data.canCreateTasks).toBe(false);
      expect(result.data.supportsPush).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// MesaAgentRunSchema
// ---------------------------------------------------------------------------
describe('MesaAgentRunSchema', () => {
  const validRun = {
    id: 'run_r1r2r3r4',
    agentId: 'agent_0001abcd',
    input: 'Implement login',
    startedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid run', () => {
    const result = MesaAgentRunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts completed run with output', () => {
    const result = MesaAgentRunSchema.safeParse({
      ...validRun,
      taskId: 'task_a1b2c3d4',
      meetingId: 'meeting_m1m2m3m4',
      runnerType: 'implement',
      action: 'implement',
      status: 'completed',
      output: '# Done',
      outputSummary: 'Done',
      producedArtifactIds: ['A-001'],
      completedAt: '2026-01-01T01:00:00Z',
      duration: 3600000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts failed run with error', () => {
    const result = MesaAgentRunSchema.safeParse({
      ...validRun,
      status: 'failed',
      error: 'Connection refused',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty input', () => {
    const result = MesaAgentRunSchema.safeParse({ ...validRun, input: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaCheckResultSchema
// ---------------------------------------------------------------------------
describe('MesaCheckResultSchema', () => {
  const validCheck = {
    id: 'check_c1c2c3c4',
    taskId: 'task_a1b2c3d4',
    checkName: 'Unit Tests',
    status: 'passed' as const,
    success: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid passing check', () => {
    const result = MesaCheckResultSchema.safeParse(validCheck);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exitCode).toBe(0);
      expect(result.data.status).toBe('passed');
    }
  });

  it('accepts a failing check', () => {
    const result = MesaCheckResultSchema.safeParse({
      ...validCheck,
      kind: 'lint',
      status: 'failed',
      success: false,
      exitCode: 1,
      stderr: 'ESLint found 3 errors',
      summary: 'Lint failed',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('failed');
    }
  });

  it('accepts check with runId and duration', () => {
    const result = MesaCheckResultSchema.safeParse({
      ...validCheck,
      runId: 'run_r1r2r3r4',
      duration: 3200,
      detail: 'Full test output...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing taskId', () => {
    const { taskId, ...rest } = validCheck;
    const result = MesaCheckResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MesaRepositorySchema
// ---------------------------------------------------------------------------
describe('MesaRepositorySchema', () => {
  it('accepts a valid repository', () => {
    const result = MesaRepositorySchema.safeParse({
      id: 'repo_r1r2r3r4',
      type: 'github',
      url: 'https://github.com/agentmesa/agentmesa',
      defaultBranch: 'main',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
    }
  });

  it('accepts minimal repository', () => {
    const result = MesaRepositorySchema.safeParse({
      id: 'repo_r1r2r3r4',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('none');
      expect(result.data.defaultBranch).toBe('main');
    }
  });

  it('rejects invalid repo type', () => {
    const result = MesaRepositorySchema.safeParse({
      id: 'repo_r1r2r3r4',
      type: 'svn',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Create input schemas
// ---------------------------------------------------------------------------
describe('CreateTaskInputSchema', () => {
  it('accepts minimal input', () => {
    const result = CreateTaskInputSchema.safeParse({
      title: 'Build feature',
      createdBy: 'user',
      meetingId: 'meeting_m1m2m3m4',
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal input without meetingId (auto-created)', () => {
    const result = CreateTaskInputSchema.safeParse({
      title: 'Build feature',
      createdBy: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('accepts full input with new fields', () => {
    const result = CreateTaskInputSchema.safeParse({
      title: 'Build feature',
      description: 'Full description',
      createdBy: 'user',
      assignedTo: 'agent_0001abcd',
      assignedBuilder: 'agent_0001abcd',
      reviewer: 'agent_0002abcd',
      assignedReviewer: 'agent_0002abcd',
      meetingId: 'meeting_m1m2m3m4',
      branch: 'feature/x',
      priority: 'high' as const,
      kind: 'implement' as const,
      parentTaskId: 'task_parent01',
      context: { goal: 'Add login', changedFiles: ['src/auth.ts'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    // title is required — test rejection via empty string
    const result = CreateTaskInputSchema.safeParse({
      title: '',
      createdBy: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateMessageInputSchema', () => {
  it('accepts message with all new fields', () => {
    const result = CreateMessageInputSchema.safeParse({
      meetingId: 'meeting_m1m2m3m4',
      taskId: 'task_a1b2c3d4',
      threadId: 'thread_t1t2t3t4',
      replyToMessageId: 'msg_prev001',
      from: 'agent_0001abcd',
      type: 'review_request' as const,
      summary: 'Please review',
      body: 'Here is the implementation',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateMeetingInputSchema', () => {
  it('accepts meeting with new fields', () => {
    const result = CreateMeetingInputSchema.safeParse({
      title: 'Feature Review',
      purpose: 'Review the QR login implementation',
      workspaceId: 'ws_w1w2w3w4',
      ownerAgentId: 'agent_0001abcd',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateThreadInputSchema', () => {
  it('accepts thread input', () => {
    const result = CreateThreadInputSchema.safeParse({
      meetingId: 'meeting_m1m2m3m4',
      title: 'Security Discussion',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing meetingId', () => {
    const result = CreateThreadInputSchema.safeParse({ title: 'No meeting' });
    expect(result.success).toBe(false);
  });
});

describe('CreateDecisionInputSchema', () => {
  it('accepts decision input', () => {
    const result = CreateDecisionInputSchema.safeParse({
      meetingId: 'meeting_m1m2m3m4',
      decidedBy: 'user',
      options: ['A', 'B'],
      selectedOption: 'A',
      rationale: 'Best choice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty options', () => {
    const result = CreateDecisionInputSchema.safeParse({
      meetingId: 'meeting_m1m2m3m4',
      decidedBy: 'user',
      options: [],
      selectedOption: 'A',
      rationale: 'Best choice',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateAgentRunInputSchema', () => {
  it('accepts minimal run input', () => {
    const result = CreateAgentRunInputSchema.safeParse({
      agentId: 'agent_0001abcd',
      input: 'Implement login',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty input', () => {
    const result = CreateAgentRunInputSchema.safeParse({
      agentId: 'agent_0001abcd',
      input: '',
    });
    expect(result.success).toBe(false);
  });
});
