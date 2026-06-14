import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  writeReviewRequest,
  writeReviewResult,
  listOutboundHandoffs,
  listInboundHandoffs,
} from '../services/handoff-service.js';
import { RoleBasedPolicyEngine } from '../runtime/policy.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('writeReviewRequest (outbox)', () => {
  it('writes a review_request envelope to outbox', () => {
    const env = writeReviewRequest(ctx, {
      taskId: 'task_test1234',
      runId: 'run_test5678',
      artifactId: 'artifact_aaaa',
      requestedReviewer: 'reviewer-1',
      summary: 'Please review the login implementation',
    });

    expect(env.id).toMatch(/^env_/);
    expect(env.type).toBe('review_request');
    expect(env.direction).toBe('outbound');
    expect(env.status).toBe('pending');
    expect(env.payload.taskId).toBe('task_test1234');
    expect(env.payload.runId).toBe('run_test5678');
    expect(env.payload.artifactId).toBe('artifact_aaaa');
    expect(env.payload.requestedReviewer).toBe('reviewer-1');
    expect(env.payload.summary).toBe('Please review the login implementation');

    // Verify file exists in outbox
    const outboxFile = join(paths.outboxDir, `${env.id}.json`);
    expect(existsSync(outboxFile)).toBe(true);
  });

  it('appears in outbound list', () => {
    writeReviewRequest(ctx, {
      taskId: 'task_test1234',
      runId: 'run_1',
      artifactId: 'artifact_a',
      requestedReviewer: 'r1',
      summary: 'Review A',
    });
    writeReviewRequest(ctx, {
      taskId: 'task_test1234',
      runId: 'run_2',
      artifactId: 'artifact_b',
      requestedReviewer: 'r2',
      summary: 'Review B',
    });

    const outbound = listOutboundHandoffs(ctx);
    expect(outbound).toHaveLength(2);
    expect(outbound[0].type).toBe('review_request');
    expect(outbound[1].type).toBe('review_request');
  });

  it('includes correlationId linked to runId', () => {
    const env = writeReviewRequest(ctx, {
      taskId: 'task_x',
      runId: 'run_y',
      artifactId: 'artifact_z',
      requestedReviewer: 'r',
      summary: 'Test',
    });
    expect(env.correlationId).toBe('run_y');
  });
});

describe('writeReviewResult (inbox)', () => {
  it('writes a review_result envelope to inbox', () => {
    const env = writeReviewResult(ctx, {
      taskId: 'task_test1234',
      runId: 'run_test5678',
      artifactId: 'artifact_aaaa',
      reviewer: 'reviewer-1',
      summary: 'LGTM, approved',
      verdict: 'approved',
    });

    expect(env.id).toMatch(/^env_/);
    expect(env.type).toBe('review_result');
    expect(env.direction).toBe('inbound');
    expect(env.status).toBe('pending');
    expect(env.payload.verdict).toBe('approved');
    expect(env.payload.reviewer).toBe('reviewer-1');

    const inboxFile = join(paths.inboxDir, `${env.id}.json`);
    expect(existsSync(inboxFile)).toBe(true);
  });

  it('handles changes_requested verdict', () => {
    const env = writeReviewResult(ctx, {
      taskId: 'task_x',
      runId: 'run_y',
      artifactId: 'artifact_z',
      reviewer: 'r1',
      summary: 'Needs work',
      verdict: 'changes_requested',
      detail: 'Missing error handling in auth flow',
    });
    expect(env.payload.verdict).toBe('changes_requested');
    expect(env.payload.detail).toBe('Missing error handling in auth flow');
  });

  it('appears in inbound list', () => {
    writeReviewResult(ctx, {
      taskId: 'task_1',
      runId: 'run_1',
      artifactId: 'artifact_1',
      reviewer: 'r1',
      summary: 'OK',
      verdict: 'approved',
    });
    writeReviewResult(ctx, {
      taskId: 'task_2',
      runId: 'run_2',
      artifactId: 'artifact_2',
      reviewer: 'r2',
      summary: 'OK',
      verdict: 'approved',
    });

    const inbound = listInboundHandoffs(ctx);
    expect(inbound).toHaveLength(2);
  });
});

describe('handoff end-to-end loop', () => {
  it('review_request outbox → review_result inbox handoff loop', () => {
    // AI A completes artifact, writes review_request to outbox
    const request = writeReviewRequest(ctx, {
      taskId: 'task_loop',
      runId: 'run_loop',
      artifactId: 'artifact_loop',
      requestedReviewer: 'codex',
      summary: 'Review the fix',
    });

    // AI B reads outbound, writes review_result to inbox
    const result = writeReviewResult(ctx, {
      taskId: 'task_loop',
      runId: 'run_loop',
      artifactId: 'artifact_loop',
      reviewer: 'codex',
      summary: 'Approved with comments',
      verdict: 'approved',
      detail: 'Consider adding more tests',
    });

    // Verify both envelopes are linked via correlationId/runId
    expect(request.correlationId).toBe('run_loop');
    expect(result.correlationId).toBe('run_loop');

    // Verify outbound shows the request
    const outbound = listOutboundHandoffs(ctx);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].type).toBe('review_request');

    // Verify inbound shows the result
    const inbound = listInboundHandoffs(ctx);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].type).toBe('review_result');
  });
});

describe('corrupted envelope resilience', () => {
  it('listOutbound skips corrupted envelope files', () => {
    // Write a valid envelope first
    writeReviewRequest(ctx, {
      taskId: 'task_a',
      runId: 'run_a',
      artifactId: 'artifact_a',
      requestedReviewer: 'r1',
      summary: 'Valid',
    });

    // Write a corrupted envelope file directly
    writeFileSync(join(paths.outboxDir, 'env_badfile.json'), 'not valid json {{{');

    // Write another valid envelope
    writeReviewRequest(ctx, {
      taskId: 'task_b',
      runId: 'run_b',
      artifactId: 'artifact_b',
      requestedReviewer: 'r1',
      summary: 'Another valid',
    });

    // Should list only the 2 valid envelopes, skipping the corrupted one
    const outbound = listOutboundHandoffs(ctx);
    expect(outbound).toHaveLength(2);
  });

  it('listInbound skips corrupted envelope files', () => {
    writeReviewResult(ctx, {
      taskId: 'task_a',
      runId: 'run_a',
      artifactId: 'artifact_a',
      reviewer: 'r1',
      summary: 'OK',
      verdict: 'approved',
    });

    writeFileSync(join(paths.inboxDir, 'env_corrupt.json'), '{ broken json');

    const inbound = listInboundHandoffs(ctx);
    expect(inbound).toHaveLength(1);
  });

  it('does not throw when outbox directory is empty', () => {
    // Fresh workspace with empty outbox
    const outbound = listOutboundHandoffs(ctx);
    expect(outbound).toEqual([]);
  });

  it('does not throw when inbox directory is empty', () => {
    const inbound = listInboundHandoffs(ctx);
    expect(inbound).toEqual([]);
  });
});
