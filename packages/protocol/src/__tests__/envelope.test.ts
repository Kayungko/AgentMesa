import { describe, it, expect } from 'vitest';
import { TransportEnvelopeSchema } from '../envelope.js';
import { generateEnvelopeId } from '../ids.js';

describe('TransportEnvelopeSchema', () => {
  const validEnvelope = {
    id: 'env_e1e2e3e4',
    transport: 'File Transport',
    direction: 'inbound' as const,
    actor: 'user',
    type: 'task_created',
    payload: { title: 'Test' },
    createdAt: '2026-06-01T10:00:00Z',
  };

  it('accepts a valid envelope with defaults', () => {
    const result = TransportEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocolVersion).toBe('0.2.0');
      expect(result.data.status).toBe('pending');
    }
  });

  it('accepts all optional fields', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      meetingId: 'meeting_a1b2c3d4',
      taskId: 'task_e5f6a7b8',
      correlationId: 'corr_x1y2z3w4',
      replyTo: 'env_prev0001',
      status: 'processed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts failed envelope with error', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      status: 'failed',
      error: 'Connection timeout',
    });
    expect(result.success).toBe(true);
  });

  it('accepts outbound direction', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      direction: 'outbound',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid direction', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      direction: 'sideways',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      status: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      id: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty transport name', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      transport: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty type', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      type: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field (type)', () => {
    const { type, ...rest } = validEnvelope;
    const result = TransportEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts empty payload', () => {
    const result = TransportEnvelopeSchema.safeParse({
      ...validEnvelope,
      payload: {},
    });
    expect(result.success).toBe(true);
  });

  it('round-trips a generated envelope', () => {
    const env = {
      id: generateEnvelopeId(),
      protocolVersion: '0.2.0' as const,
      transport: 'File Transport',
      direction: 'inbound' as const,
      actor: 'agent:claude',
      type: 'message_created',
      payload: { body: 'Hello' },
      createdAt: new Date().toISOString(),
    };
    const result = TransportEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toMatch(/^env_/);
      expect(result.data.status).toBe('pending');
    }
  });
});
