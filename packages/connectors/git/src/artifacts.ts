import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact } from '@agentmesa/core';
import { gitDiff } from './git.js';

export function createGitDiffArtifact(
  paths: MesaWorkspacePaths,
  taskId: string | undefined,
  agentId: string,
  cwd: string,
  options?: { staged?: boolean; ref?: string }
): { artifactId: string; diff: string } {
  const diff = gitDiff(cwd, options);

  const artifact = createArtifact(paths, {
    kind: 'git_diff',
    taskId,
    createdBy: agentId,
    content: diff,
    format: 'diff',
    metadata: {
      staged: options?.staged ?? false,
      ref: options?.ref,
      generatedAt: new Date().toISOString(),
    },
  });

  return { artifactId: artifact.id, diff };
}
