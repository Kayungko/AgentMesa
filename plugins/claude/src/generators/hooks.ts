export interface HookConfigOptions {
  mesaDir?: string;
}

export interface HookDefinition {
  event: string;
  matcher: string;
  command: string;
  description: string;
}

export interface HookConfig {
  hooks: HookDefinition[];
}

export function generateHookConfig(options: HookConfigOptions = {}): HookConfig {
  const { mesaDir } = options;
  const dir = mesaDir ?? '.mesa';

  return {
    hooks: [
      {
        event: 'PostStop',
        matcher: '',
        command: `mesa task update --auto-status ready_for_review --dir ${dir}`,
        description: 'After implementation completes, auto-update the task status to ready_for_review.',
      },
    ],
  };
}
