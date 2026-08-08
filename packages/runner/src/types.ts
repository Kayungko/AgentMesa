import type { MesaTask, RunProgress, TaskContext } from '@agentmesa/protocol';

export type RunnerType =
  | 'claude-implement'
  | 'claude-fix'
  | 'codex-review'
  | 'codex-test'
  | 'shell-check'
  | 'document';

export type RunProgressSink = (progress: RunProgress) => void | Promise<void>;

export interface RunOptions {
  taskId: string;
  runnerType: RunnerType;
  agentId: string;
  dryRun?: boolean;
  timeout?: number;
  extraPrompt?: string;
  onProgress?: RunProgressSink;
}

export interface RunResult {
  success: boolean;
  runnerType: RunnerType;
  taskId: string;
  agentId: string;
  output: string;
  artifacts: string[];
  duration: number;
  dryRun: boolean;
}

export interface Runner {
  run(options: RunOptions): Promise<RunResult>;
}

export interface PromptBuilderDeps {
  task: MesaTask;
  context?: TaskContext;
  reviewContent?: string;
  diff?: string;
}
