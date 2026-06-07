import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact } from '@agentmesa/core';
import type { PullRequestInfo, CIStatus } from './types.js';

/**
 * Create artifact for PR diff
 */
export async function createPrDiffArtifact(
  paths: MesaWorkspacePaths,
  taskId: string,
  agentId: string,
  diff: string,
  prNumber: number
): Promise<string> {
  const artifact = await createArtifact(paths, {
    taskId,
    createdBy: agentId,
    kind: 'git_diff',
    content: diff,
    format: 'diff',
    metadata: { prNumber: String(prNumber) },
  });

  return artifact.id;
}

/**
 * Create artifact for PR summary
 */
export async function createPrSummaryArtifact(
  paths: MesaWorkspacePaths,
  taskId: string,
  agentId: string,
  pr: PullRequestInfo
): Promise<string> {
  const summary = {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    author: pr.author,
    url: pr.url,
    labels: pr.labels,
    summaryAt: new Date().toISOString(),
  };

  const artifact = await createArtifact(paths, {
    taskId,
    createdBy: agentId,
    kind: 'pr_summary',
    content: JSON.stringify(summary, null, 2),
    format: 'json',
    metadata: { prNumber: String(pr.number) },
  });

  return artifact.id;
}

/**
 * Create artifact for CI results
 */
export async function createCIResultArtifact(
  paths: MesaWorkspacePaths,
  taskId: string,
  agentId: string,
  results: CIStatus[]
): Promise<string> {
  const artifact = await createArtifact(paths, {
    taskId,
    createdBy: agentId,
    kind: 'test_result',
    content: JSON.stringify(results, null, 2),
    format: 'json',
    metadata: { count: String(results.length) },
  });

  return artifact.id;
}
