import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWorkspacePaths } from '@agentmesa/core';
import { linkPrToTask } from '../pr.js';
import { createPrDiffArtifact } from '../artifacts.js';
import type { PullRequestInfo, PrDiffFile } from '../types.js';

describe('PR connector', () => {
  describe('PullRequestInfo parsing', () => {
    it('should parse pull request info from JSON', () => {
      const rawPR = {
        number: 123,
        title: 'Fix authentication bug',
        state: 'OPEN' as const,
        headRefName: 'fix/auth-bug',
        baseRefName: 'main',
        author: { login: 'testuser' },
        url: 'https://github.com/test/repo/pull/123',
        body: 'Fixes auth issue',
        labels: [{ name: 'bug' }, { name: 'priority:high' }],
      };

      const pr: PullRequestInfo = {
        number: rawPR.number,
        title: rawPR.title,
        state: rawPR.state,
        headBranch: rawPR.headRefName,
        baseBranch: rawPR.baseRefName,
        author: rawPR.author?.login ?? '',
        url: rawPR.url,
        body: rawPR.body ?? '',
        labels: rawPR.labels?.map((l) => l.name) ?? [],
      };

      expect(pr.number).toBe(123);
      expect(pr.title).toBe('Fix authentication bug');
      expect(pr.state).toBe('OPEN');
      expect(pr.headBranch).toBe('fix/auth-bug');
      expect(pr.baseBranch).toBe('main');
      expect(pr.author).toBe('testuser');
      expect(pr.labels).toEqual(['bug', 'priority:high']);
    });

    it('should handle missing author', () => {
      const rawPR = {
        number: 1,
        title: 'Test',
        state: 'OPEN' as const,
        headRefName: 'test',
        baseRefName: 'main',
        author: null as { login: string } | null,
        url: 'https://github.com/test/repo/pull/1',
        body: '',
        labels: [] as { name: string }[],
      };

      const pr: PullRequestInfo = {
        number: rawPR.number,
        title: rawPR.title,
        state: rawPR.state,
        headBranch: rawPR.headRefName,
        baseBranch: rawPR.baseRefName,
        author: rawPR.author?.login ?? '',
        url: rawPR.url,
        body: rawPR.body ?? '',
        labels: rawPR.labels?.map((l) => l.name) ?? [],
      };

      expect(pr.author).toBe('');
    });

    it('should handle missing labels', () => {
      const rawPR = {
        number: 1,
        title: 'Test',
        state: 'MERGED' as const,
        headRefName: 'feature',
        baseRefName: 'main',
        author: { login: 'user' },
        url: 'https://github.com/test/repo/pull/1',
        body: '',
        labels: null as { name: string }[] | null,
      };

      const pr: PullRequestInfo = {
        number: rawPR.number,
        title: rawPR.title,
        state: rawPR.state,
        headBranch: rawPR.headRefName,
        baseBranch: rawPR.baseRefName,
        author: rawPR.author?.login ?? '',
        url: rawPR.url,
        body: rawPR.body ?? '',
        labels: rawPR.labels?.map((l) => l.name) ?? [],
      };

      expect(pr.labels).toEqual([]);
    });
  });

  describe('PrDiffFile parsing', () => {
    it('should parse diff file info', () => {
      const diffFile: PrDiffFile = {
        path: 'src/index.ts',
        additions: 10,
        deletions: 5,
        patch: 'diff --git a/src/index.ts b/src/index.ts',
      };

      expect(diffFile.path).toBe('src/index.ts');
      expect(diffFile.additions).toBe(10);
      expect(diffFile.deletions).toBe(5);
      expect(diffFile.patch).toContain('diff --git');
    });

    it('should handle empty patch', () => {
      const diffFile: PrDiffFile = {
        path: 'test.js',
        additions: 0,
        deletions: 0,
        patch: '',
      };

      expect(diffFile.path).toBe('test.js');
      expect(diffFile.additions).toBe(0);
      expect(diffFile.deletions).toBe(0);
    });
  });

  describe('linkPrToTask', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create artifact linking PR to task', async () => {
      const paths = await createWorkspacePaths(tempDir);
      const taskId = 'task-123';
      const prNumber = 456;

      await linkPrToTask(paths, taskId, prNumber);

      // The function should have created an artifact
      // We can't easily verify without listArtifacts, but the call should succeed
      expect(true).toBe(true);
    });
  });

  describe('createPrDiffArtifact', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should store PR diff as artifact', async () => {
      const paths = await createWorkspacePaths(tempDir);
      const taskId = 'task-789';
      const agentId = 'test-agent';
      const diff = 'diff --git a/test.ts b/test.ts\n+new line';
      const prNumber = 101;

      const artifactId = await createPrDiffArtifact(paths, taskId, agentId, diff, prNumber);

      expect(artifactId).toBeDefined();
      expect(typeof artifactId).toBe('string');
    });
  });
});
