import { execSync } from 'child_process';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact } from '@agentmesa/core';
import type { PullRequestInfo, PrDiffFile } from './types.js';

/**
 * List pull requests using gh CLI
 */
export function listPullRequests(
  cwd: string,
  options?: { state?: 'open' | 'closed' | 'merged' | 'all'; limit?: number }
): PullRequestInfo[] {
  try {
    const state = options?.state ?? 'open';
    const limit = options?.limit ?? 30;
    const cmd = `gh pr list --state ${state} --limit ${limit} --json number,title,state,headRefName,baseRefName,author,url,body,labels`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8' });
    const data = JSON.parse(output);

    return data.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      author: pr.author?.login ?? '',
      url: pr.url,
      body: pr.body ?? '',
      labels: pr.labels?.map((l: any) => l.name) ?? [],
    }));
  } catch (error) {
    throw new Error(`Failed to list pull requests: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a specific pull request
 */
export function getPullRequest(cwd: string, prNumber: number): PullRequestInfo {
  try {
    const cmd = `gh pr view ${prNumber} --json number,title,state,headRefName,baseRefName,author,url,body,labels`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8' });
    const pr = JSON.parse(output);

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      author: pr.author?.login ?? '',
      url: pr.url,
      body: pr.body ?? '',
      labels: pr.labels?.map((l: any) => l.name) ?? [],
    };
  } catch (error) {
    throw new Error(`Failed to get pull request #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get PR diff as string
 */
export function getPrDiff(cwd: string, prNumber: number): string {
  try {
    const cmd = `gh pr diff ${prNumber}`;
    return execSync(cmd, { cwd, encoding: 'utf-8' });
  } catch (error) {
    throw new Error(`Failed to get diff for PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get PR diff files with additions/deletions
 */
export function getPrDiffFiles(cwd: string, prNumber: number): PrDiffFile[] {
  try {
    const cmd = `gh pr diff ${prNumber} --patch`;
    const patch = execSync(cmd, { cwd, encoding: 'utf-8' });

    // Parse patch output into files
    const files: PrDiffFile[] = [];
    const fileSections = patch.split(/^diff --git /m).slice(1);

    for (const section of fileSections) {
      const pathMatch = section.match(/a\/(.+?) b\/(.+?)\n/);
      if (!pathMatch || !pathMatch[2]) continue;

      const path = pathMatch[2];
      const additions = (section.match(/^\+/gm) ?? []).length;
      const deletions = (section.match(/^-/gm) ?? []).length;

      files.push({
        path,
        additions,
        deletions,
        patch: section,
      });
    }

    return files;
  } catch (error) {
    throw new Error(`Failed to get diff files for PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create a new pull request
 */
export function createPullRequest(
  cwd: string,
  options: { title: string; body: string; base?: string; head?: string }
): PullRequestInfo {
  try {
    const base = options.base ? `--base ${options.base}` : '';
    const head = options.head ? `--head ${options.head}` : '';
    const cmd = `gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body "${options.body.replace(/"/g, '\\"')}" ${base} ${head} --json number,title,state,headRefName,baseRefName,author,url,body,labels`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8' });
    const pr = JSON.parse(output);

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      author: pr.author?.login ?? '',
      url: pr.url,
      body: pr.body ?? '',
      labels: pr.labels?.map((l: any) => l.name) ?? [],
    };
  } catch (error) {
    throw new Error(`Failed to create pull request: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Link a PR to a task by storing PR link as artifact
 */
export async function linkPrToTask(
  paths: MesaWorkspacePaths,
  taskId: string,
  prNumber: number
): Promise<void> {
  const prLink = {
    prNumber,
    linkedAt: new Date().toISOString(),
    kind: 'pr_summary',
  };

  await createArtifact(paths, {
    taskId,
    createdBy: 'github-connector',
    kind: 'pr_summary',
    content: JSON.stringify(prLink, null, 2),
    format: 'json',
    metadata: { prNumber: String(prNumber) },
  });
}
