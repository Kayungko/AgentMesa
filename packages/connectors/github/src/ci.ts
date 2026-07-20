import { execSync } from 'child_process';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact, createCheckResult, createRuntimeContext } from '@agentmesa/core';
import type { CreateCheckResultInput } from '@agentmesa/protocol';
import type { CIStatus } from './types.js';

/**
 * Get CI status for a PR or branch
 */
export function getCIStatus(
  cwd: string,
  options?: { prNumber?: number; branch?: string }
): CIStatus[] {
  try {
    let cmd = 'gh run list';

    if (options?.prNumber) {
      cmd += ` --json name,status,conclusion,url`;
    } else if (options?.branch) {
      cmd += ` --branch ${options.branch} --json name,status,conclusion,url`;
    } else {
      cmd += ' --json name,status,conclusion,url';
    }

    cmd += ' --limit 20';
    const output = execSync(cmd, { cwd, encoding: 'utf-8' });
    const data = JSON.parse(output);

    return data.map((run: any) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.url,
    }));
  } catch (error) {
    throw new Error(`Failed to get CI status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Map a GitHub Actions run status into a MesaCheckResult creation input.
 * Returns null for runs that are still in progress (no conclusion yet) —
 * there is no finished result to record for those.
 */
export function ciStatusToCheckResultInput(
  status: CIStatus,
  taskId: string,
): CreateCheckResultInput | null {
  if (status.conclusion === null) {
    return null;
  }

  const success = status.conclusion === 'success';
  const resultStatus: CreateCheckResultInput['status'] =
    status.conclusion === 'success'
      ? 'passed'
      : status.conclusion === 'failure'
        ? 'failed'
        : status.conclusion === 'cancelled' || status.conclusion === 'skipped'
          ? 'skipped'
          : 'error';

  return {
    taskId,
    kind: 'custom',
    status: resultStatus,
    checkName: status.name,
    exitCode: success ? 0 : 1,
    success,
    summary: `${status.name}: ${status.conclusion}`,
    detail: status.url,
  };
}

/**
 * Import CI results: stores the raw status list as an artifact (for
 * backward-compatible full-payload inspection) and records one MesaCheckResult
 * per finished run so `mesa checks` / `mesa_list_checks` can query them.
 */
export async function importCIResults(
  paths: MesaWorkspacePaths,
  taskId: string,
  agentId: string,
  cwd: string
): Promise<{ artifactId: string; checkResultIds: string[] }> {
  const results = getCIStatus(cwd);
  const ctx = createRuntimeContext({
    rootDir: paths.rootDir,
    actor: {
      id: agentId,
      type: 'agent',
      roles: ['ci'],
      client: 'github',
    },
  });

  const artifact = await createArtifact(ctx, {
    taskId,
    kind: 'test_result',
    content: JSON.stringify(results, null, 2),
    format: 'json',
    metadata: { count: String(results.length) },
  });

  const checkResultIds: string[] = [];
  for (const status of results) {
    const input = ciStatusToCheckResultInput(status, taskId);
    if (input) {
      const check = createCheckResult(ctx, input);
      checkResultIds.push(check.id);
    }
  }

  return { artifactId: artifact.id, checkResultIds };
}
