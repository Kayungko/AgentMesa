import { describe, it, expect } from 'vitest';
import {
  generateTaskId,
  generateMeetingId,
  generateMessageId,
  generateArtifactId,
  generateEventId,
  generateDecisionId,
  generateThreadId,
  generateAgentRunId,
  generateClientId,
} from '../ids.js';

describe('ID generators', () => {
  it('generateTaskId returns task_xxxxxxxx', () => {
    const id = generateTaskId();
    expect(id).toMatch(/^task_[0-9a-f]{8}$/);
  });

  it('generateMeetingId returns meeting_xxxxxxxx', () => {
    const id = generateMeetingId();
    expect(id).toMatch(/^meeting_[0-9a-f]{8}$/);
  });

  it('generateMessageId returns msg_xxxxxxxx', () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg_[0-9a-f]{8}$/);
  });

  it('generateArtifactId returns artifact_xxxxxxxx', () => {
    const id = generateArtifactId();
    expect(id).toMatch(/^artifact_[0-9a-f]{8}$/);
  });

  it('generateEventId returns event_xxxxxxxx', () => {
    const id = generateEventId();
    expect(id).toMatch(/^event_[0-9a-f]{8}$/);
  });

  it('generateDecisionId returns decision_xxxxxxxx', () => {
    const id = generateDecisionId();
    expect(id).toMatch(/^decision_[0-9a-f]{8}$/);
  });

  it('generateThreadId returns thread_xxxxxxxx', () => {
    const id = generateThreadId();
    expect(id).toMatch(/^thread_[0-9a-f]{8}$/);
  });

  it('generateAgentRunId returns run_xxxxxxxx', () => {
    const id = generateAgentRunId();
    expect(id).toMatch(/^run_[0-9a-f]{8}$/);
  });

  it('generateClientId returns client_xxxxxxxx', () => {
    const id = generateClientId();
    expect(id).toMatch(/^client_[0-9a-f]{8}$/);
  });

  it('each call produces a unique ID', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateTaskId());
    }
    expect(ids.size).toBe(50);
  });

  it('different generators produce different prefixes', () => {
    const taskId = generateTaskId();
    const meetingId = generateMeetingId();
    const msgId = generateMessageId();
    const eventId = generateEventId();
    const decisionId = generateDecisionId();
    const threadId = generateThreadId();
    const runId = generateAgentRunId();
    const clientId = generateClientId();
    const artifactId = generateArtifactId();

    expect(taskId).not.toBe(meetingId);
    expect(msgId).not.toBe(eventId);
    expect(decisionId).not.toBe(threadId);
    expect(runId).not.toBe(clientId);
    expect(artifactId).not.toBe(taskId);

    // Verify all have different prefixes
    const prefixes = [
      taskId.split('_')[0],
      meetingId.split('_')[0],
      msgId.split('_')[0],
      eventId.split('_')[0],
      decisionId.split('_')[0],
      threadId.split('_')[0],
      runId.split('_')[0],
      clientId.split('_')[0],
      artifactId.split('_')[0],
    ];
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(9);
  });
});
