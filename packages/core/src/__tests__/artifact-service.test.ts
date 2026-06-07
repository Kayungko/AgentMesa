import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { createArtifact, getArtifact, listArtifacts } from '../services/artifact-service.js';
import { ArtifactNotFoundError } from '../errors.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'agent:test', type: 'agent', roles: ['reviewer'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createArtifact', () => {
  it('creates an artifact', () => {
    const artifact = createArtifact(ctx, {
      kind: 'review_report',
      taskId: 'T-0001',
      createdBy: 'spoofed-agent',
      content: '# Review\nLooks good',
      format: 'markdown',
    });
    expect(artifact.id).toMatch(/^artifact_/);
    expect(artifact.kind).toBe('review_report');
    expect(artifact.taskId).toBe('T-0001');
    expect(artifact.createdBy).toBe('agent:test');
    expect(artifact.content).toBe('# Review\nLooks good');
    expect(artifact.format).toBe('markdown');
    expect(artifact.protocolVersion).toBe('0.2.0');
  });

  it('creates artifact with metadata', () => {
    const artifact = createArtifact(ctx, {
      kind: 'test_result',
      content: '{"passed": true}',
      format: 'json',
      metadata: { passed: true, total: 42 },
    });
    expect(artifact.metadata).toEqual({ passed: true, total: 42 });
  });

  it('generates unique artifact IDs', () => {
    const a1 = createArtifact(ctx, { kind: 'git_diff', content: 'diff1' });
    const a2 = createArtifact(ctx, { kind: 'git_diff', content: 'diff2' });
    expect(a1.id).toMatch(/^artifact_/);
    expect(a2.id).toMatch(/^artifact_/);
    expect(a1.id).not.toBe(a2.id);
  });
});

describe('getArtifact', () => {
  it('retrieves a created artifact', () => {
    const created = createArtifact(ctx, {
      kind: 'review_report',
      content: 'review content',
    });
    const fetched = getArtifact(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.content).toBe('review content');
  });

  it('throws for non-existent artifact', () => {
    expect(() => getArtifact(ctx, 'A-9999')).toThrow(ArtifactNotFoundError);
  });
});

describe('listArtifacts', () => {
  it('returns empty when no artifacts', () => {
    expect(listArtifacts(ctx)).toEqual([]);
  });

  it('lists all artifacts', () => {
    createArtifact(ctx, { kind: 'review_report', content: 'r1' });
    createArtifact(ctx, { kind: 'git_diff', content: 'd1' });
    expect(listArtifacts(ctx)).toHaveLength(2);
  });

  it('filters by taskId', () => {
    createArtifact(ctx, { kind: 'review_report', taskId: 'T-0001', content: 'r1' });
    createArtifact(ctx, { kind: 'review_report', taskId: 'T-0002', content: 'r2' });
    createArtifact(ctx, { kind: 'git_diff', taskId: 'T-0001', content: 'd1' });

    const task1Artifacts = listArtifacts(ctx, 'T-0001');
    expect(task1Artifacts).toHaveLength(2);
    expect(task1Artifacts.every((a) => a.taskId === 'T-0001')).toBe(true);
  });

  it('filters by kind', () => {
    createArtifact(ctx, { kind: 'review_report', content: 'r1' });
    createArtifact(ctx, { kind: 'git_diff', content: 'd1' });
    createArtifact(ctx, { kind: 'review_report', content: 'r2' });

    const reports = listArtifacts(ctx, undefined, 'review_report');
    expect(reports).toHaveLength(2);
    expect(reports.every((a) => a.kind === 'review_report')).toBe(true);
  });

  it('filters by both taskId and kind', () => {
    createArtifact(ctx, { kind: 'review_report', taskId: 'T-0001', content: 'r1' });
    createArtifact(ctx, { kind: 'git_diff', taskId: 'T-0001', content: 'd1' });
    createArtifact(ctx, { kind: 'review_report', taskId: 'T-0002', content: 'r2' });

    const result = listArtifacts(ctx, 'T-0001', 'review_report');
    expect(result).toHaveLength(1);
    expect(result[0]?.taskId).toBe('T-0001');
    expect(result[0]?.kind).toBe('review_report');
  });
});

describe('runtime context integration', () => {
  it('records artifact events with runtime actor', () => {
    const artifact = createArtifact(ctx, { kind: 'review_report', content: 'review' });
    const events = ctx.eventStore.list({ streamId: artifact.id });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('artifact_created');
    expect(events[0]!.actor).toBe('agent:test');
  });

  it('rejects artifacts denied by policy', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:blocked', type: 'agent', roles: ['reviewer'] },
      policy: { can: () => ({ allowed: false, reason: 'blocked' }) },
    });

    expect(() => createArtifact(deniedCtx, { kind: 'review_report', content: 'nope' })).toThrow(
      'Policy denied'
    );
  });
});
