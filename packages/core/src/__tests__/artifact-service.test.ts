import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createArtifact, getArtifact, listArtifacts } from '../services/artifact-service.js';
import { ArtifactNotFoundError } from '../errors.js';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createArtifact', () => {
  it('creates an artifact', () => {
    const artifact = createArtifact(paths, {
      kind: 'review_report',
      taskId: 'T-0001',
      createdBy: 'agent-1',
      content: '# Review\nLooks good',
      format: 'markdown',
    });
    expect(artifact.id).toMatch(/^artifact_/);
    expect(artifact.kind).toBe('review_report');
    expect(artifact.taskId).toBe('T-0001');
    expect(artifact.content).toBe('# Review\nLooks good');
    expect(artifact.format).toBe('markdown');
    expect(artifact.protocolVersion).toBe('0.2.0');
  });

  it('creates artifact with metadata', () => {
    const artifact = createArtifact(paths, {
      kind: 'test_result',
      createdBy: 'agent-1',
      content: '{"passed": true}',
      format: 'json',
      metadata: { passed: true, total: 42 },
    });
    expect(artifact.metadata).toEqual({ passed: true, total: 42 });
  });

  it('generates unique artifact IDs', () => {
    const a1 = createArtifact(paths, { kind: 'git_diff', createdBy: 'agent-1', content: 'diff1' });
    const a2 = createArtifact(paths, { kind: 'git_diff', createdBy: 'agent-1', content: 'diff2' });
    expect(a1.id).toMatch(/^artifact_/);
    expect(a2.id).toMatch(/^artifact_/);
    expect(a1.id).not.toBe(a2.id);
  });
});

describe('getArtifact', () => {
  it('retrieves a created artifact', () => {
    const created = createArtifact(paths, {
      kind: 'review_report',
      createdBy: 'agent-1',
      content: 'review content',
    });
    const fetched = getArtifact(paths, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.content).toBe('review content');
  });

  it('throws for non-existent artifact', () => {
    expect(() => getArtifact(paths, 'A-9999')).toThrow(ArtifactNotFoundError);
  });
});

describe('listArtifacts', () => {
  it('returns empty when no artifacts', () => {
    expect(listArtifacts(paths)).toEqual([]);
  });

  it('lists all artifacts', () => {
    createArtifact(paths, { kind: 'review_report', createdBy: 'agent-1', content: 'r1' });
    createArtifact(paths, { kind: 'git_diff', createdBy: 'agent-1', content: 'd1' });
    expect(listArtifacts(paths)).toHaveLength(2);
  });

  it('filters by taskId', () => {
    createArtifact(paths, { kind: 'review_report', taskId: 'T-0001', createdBy: 'agent-1', content: 'r1' });
    createArtifact(paths, { kind: 'review_report', taskId: 'T-0002', createdBy: 'agent-1', content: 'r2' });
    createArtifact(paths, { kind: 'git_diff', taskId: 'T-0001', createdBy: 'agent-1', content: 'd1' });

    const task1Artifacts = listArtifacts(paths, 'T-0001');
    expect(task1Artifacts).toHaveLength(2);
    expect(task1Artifacts.every((a) => a.taskId === 'T-0001')).toBe(true);
  });

  it('filters by kind', () => {
    createArtifact(paths, { kind: 'review_report', createdBy: 'agent-1', content: 'r1' });
    createArtifact(paths, { kind: 'git_diff', createdBy: 'agent-1', content: 'd1' });
    createArtifact(paths, { kind: 'review_report', createdBy: 'agent-1', content: 'r2' });

    const reports = listArtifacts(paths, undefined, 'review_report');
    expect(reports).toHaveLength(2);
    expect(reports.every((a) => a.kind === 'review_report')).toBe(true);
  });

  it('filters by both taskId and kind', () => {
    createArtifact(paths, { kind: 'review_report', taskId: 'T-0001', createdBy: 'agent-1', content: 'r1' });
    createArtifact(paths, { kind: 'git_diff', taskId: 'T-0001', createdBy: 'agent-1', content: 'd1' });
    createArtifact(paths, { kind: 'review_report', taskId: 'T-0002', createdBy: 'agent-1', content: 'r2' });

    const result = listArtifacts(paths, 'T-0001', 'review_report');
    expect(result).toHaveLength(1);
    expect(result[0]?.taskId).toBe('T-0001');
    expect(result[0]?.kind).toBe('review_report');
  });
});
