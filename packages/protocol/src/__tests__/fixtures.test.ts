import { describe, it, expect } from 'vitest';
import {
  fixtureBuilderAgent,
  fixtureReviewerAgent,
  fixtureBuilderCapability,
  fixtureReviewerCapability,
  fixtureTask,
  fixtureMessage,
  fixtureReviewArtifact,
  fixtureReviewReport,
  fixtureMeeting,
  fixtureThread,
  fixtureDecision,
  fixtureEvent,
  fixtureClient,
  fixtureTransportFile,
  fixtureTransportMcp,
  fixtureAgentRun,
  fixtureCheckResult,
  fixtureRepository,
} from '../fixtures.js';
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
  MesaAgentRunSchema,
  MesaCheckResultSchema,
  MesaRepositorySchema,
} from '../schemas.js';

describe('fixtures validate against schemas', () => {
  // Agents & capabilities
  it('builder agent is valid', () => {
    const result = MesaAgentSchema.safeParse(fixtureBuilderAgent);
    expect(result.success).toBe(true);
  });

  it('reviewer agent is valid', () => {
    const result = MesaAgentSchema.safeParse(fixtureReviewerAgent);
    expect(result.success).toBe(true);
  });

  it('builder capability is valid', () => {
    const result = MesaAgentCapabilitySchema.safeParse(fixtureBuilderCapability);
    expect(result.success).toBe(true);
  });

  it('reviewer capability is valid', () => {
    const result = MesaAgentCapabilitySchema.safeParse(fixtureReviewerCapability);
    expect(result.success).toBe(true);
  });

  // Core entities
  it('task is valid', () => {
    const result = MesaTaskSchema.safeParse(fixtureTask);
    expect(result.success).toBe(true);
  });

  it('message is valid', () => {
    const result = MesaMessageSchema.safeParse(fixtureMessage);
    expect(result.success).toBe(true);
  });

  it('implementation summary artifact is valid', () => {
    const result = MesaArtifactSchema.safeParse(fixtureReviewArtifact);
    expect(result.success).toBe(true);
  });

  it('review report artifact is valid', () => {
    const result = MesaArtifactSchema.safeParse(fixtureReviewReport);
    expect(result.success).toBe(true);
  });

  it('meeting is valid', () => {
    const result = MesaMeetingSchema.safeParse(fixtureMeeting);
    expect(result.success).toBe(true);
  });

  // New entities
  it('thread is valid', () => {
    const result = MesaThreadSchema.safeParse(fixtureThread);
    expect(result.success).toBe(true);
  });

  it('decision is valid', () => {
    const result = MesaDecisionSchema.safeParse(fixtureDecision);
    expect(result.success).toBe(true);
  });

  it('event is valid', () => {
    const result = MesaEventSchema.safeParse(fixtureEvent);
    expect(result.success).toBe(true);
  });

  it('client is valid', () => {
    const result = MesaClientSchema.safeParse(fixtureClient);
    expect(result.success).toBe(true);
  });

  it('file transport is valid', () => {
    const result = MesaTransportSchema.safeParse(fixtureTransportFile);
    expect(result.success).toBe(true);
  });

  it('mcp transport is valid', () => {
    const result = MesaTransportSchema.safeParse(fixtureTransportMcp);
    expect(result.success).toBe(true);
  });

  it('agent run is valid', () => {
    const result = MesaAgentRunSchema.safeParse(fixtureAgentRun);
    expect(result.success).toBe(true);
  });

  it('check result is valid', () => {
    const result = MesaCheckResultSchema.safeParse(fixtureCheckResult);
    expect(result.success).toBe(true);
  });

  it('repository is valid', () => {
    const result = MesaRepositorySchema.safeParse(fixtureRepository);
    expect(result.success).toBe(true);
  });
});

describe('fixture protocol versions', () => {
  it('all entities have protocol version 0.2.0', () => {
    expect(fixtureTask.protocolVersion).toBe('0.2.0');
    expect(fixtureMessage.protocolVersion).toBe('0.2.0');
    expect(fixtureReviewArtifact.protocolVersion).toBe('0.2.0');
    expect(fixtureReviewReport.protocolVersion).toBe('0.2.0');
    expect(fixtureMeeting.protocolVersion).toBe('0.2.0');
    expect(fixtureThread.protocolVersion).toBe('0.2.0');
    expect(fixtureDecision.protocolVersion).toBe('0.2.0');
    expect(fixtureEvent.protocolVersion).toBe('0.2.0');
    expect(fixtureAgentRun.protocolVersion).toBe('0.2.0');
    expect(fixtureCheckResult.protocolVersion).toBe('0.2.0');
    expect(fixtureRepository.protocolVersion).toBe('0.2.0');
  });
});

describe('fixture cross-references', () => {
  it('task references the meeting', () => {
    expect(fixtureTask.meetingId).toBe(fixtureMeeting.id);
  });

  it('message references the meeting', () => {
    expect(fixtureMessage.meetingId).toBe(fixtureMeeting.id);
  });

  it('message references the task', () => {
    expect(fixtureMessage.taskId).toBe(fixtureTask.id);
  });

  it('thread references the meeting', () => {
    expect(fixtureThread.meetingId).toBe(fixtureMeeting.id);
  });

  it('decision references the meeting', () => {
    expect(fixtureDecision.meetingId).toBe(fixtureMeeting.id);
  });

  it('event references the meeting', () => {
    expect(fixtureEvent.meetingId).toBe(fixtureMeeting.id);
  });

  it('agent run references the task, meeting, and agent', () => {
    expect(fixtureAgentRun.taskId).toBe(fixtureTask.id);
    expect(fixtureAgentRun.meetingId).toBe(fixtureMeeting.id);
    expect(fixtureAgentRun.agentId).toBe(fixtureBuilderAgent.id);
  });

  it('check result references the task and run', () => {
    expect(fixtureCheckResult.taskId).toBe(fixtureTask.id);
    expect(fixtureCheckResult.runId).toBe(fixtureAgentRun.id);
  });

  it('builder capability references the builder agent', () => {
    expect(fixtureBuilderCapability.agentId).toBe(fixtureBuilderAgent.id);
  });
});
