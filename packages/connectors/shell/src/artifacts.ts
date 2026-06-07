import type { MesaWorkspacePaths } from '@agentmesa/core';
import { createArtifact } from '@agentmesa/core';
import type { CheckResult } from './runner.js';

export function createCheckResultArtifact(
  paths: MesaWorkspacePaths,
  taskId: string | undefined,
  agentId: string,
  result: CheckResult
): { artifactId: string } {
  const content = [
    `# Check Result: ${result.command}`,
    '',
    `**Exit Code**: ${result.exitCode}`,
    `**Duration**: ${result.duration}ms`,
    `**Success**: ${result.success}`,
    '',
    result.stdout ? `## stdout\n\`\`\`\n${result.stdout}\n\`\`\`` : '',
    result.stderr ? `## stderr\n\`\`\`\n${result.stderr}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const artifact = createArtifact(paths, {
    kind: 'test_result',
    taskId,
    createdBy: agentId,
    content,
    format: 'markdown',
    metadata: {
      command: result.command,
      exitCode: result.exitCode,
      duration: result.duration,
      success: result.success,
    },
  });

  return { artifactId: artifact.id };
}
