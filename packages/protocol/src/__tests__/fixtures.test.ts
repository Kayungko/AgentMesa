import { describe, it, expect } from 'vitest';
import {
  fixtureBuilderAgent,
  fixtureReviewerAgent,
  fixtureTask,
  fixtureMessage,
  fixtureReviewArtifact,
  fixtureMeeting,
  fixtureReviewReport,
} from '../fixtures.js';
import {
  MesaAgentSchema,
  MesaTaskSchema,
  MesaMessageSchema,
  MesaArtifactSchema,
  MesaMeetingSchema,
} from '../schemas.js';

describe('fixtures validate against schemas', () => {
  it('builder agent is valid', () => {
    const result = MesaAgentSchema.safeParse(fixtureBuilderAgent);
    expect(result.success).toBe(true);
  });

  it('reviewer agent is valid', () => {
    const result = MesaAgentSchema.safeParse(fixtureReviewerAgent);
    expect(result.success).toBe(true);
  });

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
});

describe('fixture protocol versions', () => {
  it('all entities have protocol version 0.1.0', () => {
    expect(fixtureTask.protocolVersion).toBe('0.1.0');
    expect(fixtureMessage.protocolVersion).toBe('0.1.0');
    expect(fixtureReviewArtifact.protocolVersion).toBe('0.1.0');
    expect(fixtureReviewReport.protocolVersion).toBe('0.1.0');
    expect(fixtureMeeting.protocolVersion).toBe('0.1.0');
  });
});
