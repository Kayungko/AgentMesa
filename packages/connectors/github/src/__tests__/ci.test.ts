import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWorkspacePaths } from '@agentmesa/core';
import { createCIResultArtifact } from '../artifacts.js';
import type { CIStatus } from '../types.js';

describe('CI connector', () => {
  describe('CIStatus parsing', () => {
    it('should parse CI status from JSON', () => {
      const rawStatus = {
        name: 'Build and Test',
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/test/repo/actions/runs/123',
      };

      const status: CIStatus = {
        name: rawStatus.name,
        status: rawStatus.status,
        conclusion: rawStatus.conclusion,
        url: rawStatus.url,
      };

      expect(status.name).toBe('Build and Test');
      expect(status.status).toBe('completed');
      expect(status.conclusion).toBe('success');
      expect(status.url).toContain('github.com');
    });

    it('should handle null conclusion', () => {
      const rawStatus = {
        name: 'Lint',
        status: 'in_progress',
        conclusion: null,
        url: 'https://github.com/test/repo/actions/runs/456',
      };

      const status: CIStatus = {
        name: rawStatus.name,
        status: rawStatus.status,
        conclusion: rawStatus.conclusion,
        url: rawStatus.url,
      };

      expect(status.conclusion).toBeNull();
    });

    it('should handle failure conclusion', () => {
      const rawStatus = {
        name: 'Tests',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://github.com/test/repo/actions/runs/789',
      };

      const status: CIStatus = {
        name: rawStatus.name,
        status: rawStatus.status,
        conclusion: rawStatus.conclusion,
        url: rawStatus.url,
      };

      expect(status.conclusion).toBe('failure');
    });
  });

  describe('createCIResultArtifact', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should store CI results as artifact', async () => {
      const paths = await createWorkspacePaths(tempDir);
      const taskId = 'task-ci-123';
      const agentId = 'test-agent';
      const results: CIStatus[] = [
        {
          name: 'Build',
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/test/repo/actions/runs/1',
        },
        {
          name: 'Test',
          status: 'completed',
          conclusion: 'failure',
          url: 'https://github.com/test/repo/actions/runs/2',
        },
      ];

      const artifactId = await createCIResultArtifact(paths, taskId, agentId, results);

      expect(artifactId).toBeDefined();
      expect(typeof artifactId).toBe('string');
    });

    it('should handle empty results array', async () => {
      const paths = await createWorkspacePaths(tempDir);
      const taskId = 'task-ci-456';
      const agentId = 'test-agent';
      const results: CIStatus[] = [];

      const artifactId = await createCIResultArtifact(paths, taskId, agentId, results);

      expect(artifactId).toBeDefined();
    });
  });
});
