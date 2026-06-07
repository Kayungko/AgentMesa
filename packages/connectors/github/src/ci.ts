import { execSync } from 'child_process';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact, createRuntimeContext } from '@agentmesa/core';
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
 * Import CI results and store as artifact
 */
export async function importCIResults(
  paths: MesaWorkspacePaths,
  taskId: string,
  agentId: string,
  cwd: string
): Promise<{ artifactId: string }> {
  const results = getCIStatus(cwd);
  const ctx = createRuntimeContext({
    rootDir: paths.rootDir,
    actor: {
      id: agentId,
      type: 'agent',
      roles: ['custom'],
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

  return { artifactId: artifact.id };
}
