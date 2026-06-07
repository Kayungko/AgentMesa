import { describe, it, expect } from 'vitest';
import {
  MesaAgentSchema,
  MesaTaskSchema,
  MesaMessageSchema,
  MesaArtifactSchema,
  MesaMeetingSchema,
  MesaAgentCapabilitySchema,
  CreateTaskInputSchema,
} from '../schemas.js';

describe('MesaAgentSchema', () => {
  it('accepts a valid agent', () => {
    const result = MesaAgentSchema.safeParse({
      id: 'agent-1',
      name: 'Claude',
      client: 'claude-code',
      roles: ['builder'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty roles', () => {
    const result = MesaAgentSchema.safeParse({
      id: 'agent-1',
      name: 'Claude',
      client: 'claude-code',
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = MesaAgentSchema.safeParse({
      id: 'agent-1',
      name: 'Claude',
      client: 'claude-code',
      roles: ['invalid_role'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = MesaAgentSchema.safeParse({
      name: 'Claude',
      client: 'claude-code',
      roles: ['builder'],
    });
    expect(result.success).toBe(false);
  });
});

describe('MesaTaskSchema', () => {
  it('accepts a valid task', () => {
    const result = MesaTaskSchema.safeParse({
      id: 'T-001',
      title: 'Build feature',
      status: 'todo',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.1.0');
    }
  });

  it('accepts task with optional context', () => {
    const result = MesaTaskSchema.safeParse({
      id: 'T-001',
      title: 'Build feature',
      status: 'in_progress',
      createdBy: 'user',
      branch: 'feature/x',
      context: {
        goal: 'Add login',
        changedFiles: ['src/auth.ts'],
        commands: ['npm test'],
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = MesaTaskSchema.safeParse({
      id: 'T-001',
      title: 'Build feature',
      status: 'invalid_status',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = MesaTaskSchema.safeParse({
      id: 'T-001',
      title: '',
      status: 'todo',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MesaMessageSchema', () => {
  it('accepts a valid message', () => {
    const result = MesaMessageSchema.safeParse({
      id: 'M-001',
      taskId: 'T-001',
      from: 'agent-1',
      to: 'agent-2',
      type: 'review_request',
      summary: 'Please review',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.1.0');
    }
  });

  it('accepts message with artifact refs', () => {
    const result = MesaMessageSchema.safeParse({
      id: 'M-001',
      from: 'agent-1',
      type: 'review_result',
      summary: 'Approved',
      artifactIds: ['A-001', 'A-002'],
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid message type', () => {
    const result = MesaMessageSchema.safeParse({
      id: 'M-001',
      from: 'agent-1',
      type: 'unknown_type',
      summary: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MesaArtifactSchema', () => {
  it('accepts a valid artifact', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'review_report',
      taskId: 'T-001',
      createdBy: 'agent-1',
      content: '# Review\nLooks good',
      format: 'markdown',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.1.0');
    }
  });

  it('accepts artifact with metadata', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'test_result',
      createdBy: 'agent-1',
      content: '{"passed": true}',
      format: 'json',
      metadata: { passed: true, total: 42 },
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid artifact kind', () => {
    const result = MesaArtifactSchema.safeParse({
      id: 'A-001',
      kind: 'invalid_kind',
      createdBy: 'agent-1',
      content: 'test',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MesaMeetingSchema', () => {
  it('accepts a valid meeting', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'MTG-001',
      title: 'Feature Review',
      status: 'open',
      tasks: ['T-001'],
      agents: ['agent-1', 'agent-2'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.1.0');
    }
  });

  it('accepts empty tasks and agents', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'MTG-001',
      title: 'New Meeting',
      status: 'open',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid meeting status', () => {
    const result = MesaMeetingSchema.safeParse({
      id: 'MTG-001',
      title: 'Test',
      status: 'paused',
      tasks: [],
      agents: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MesaAgentCapabilitySchema', () => {
  it('accepts a valid capability', () => {
    const result = MesaAgentCapabilitySchema.safeParse({
      agentId: 'agent-1',
      permissions: ['builder', 'reviewer'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty permissions', () => {
    const result = MesaAgentCapabilitySchema.safeParse({
      agentId: 'agent-1',
      permissions: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateTaskInputSchema', () => {
  it('accepts minimal input', () => {
    const result = CreateTaskInputSchema.safeParse({
      title: 'Build feature',
      createdBy: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('accepts full input', () => {
    const result = CreateTaskInputSchema.safeParse({
      title: 'Build feature',
      createdBy: 'user',
      assignedTo: 'agent-1',
      reviewer: 'agent-2',
      branch: 'feature/x',
      context: { goal: 'Add login', changedFiles: ['src/auth.ts'] },
    });
    expect(result.success).toBe(true);
  });
});
