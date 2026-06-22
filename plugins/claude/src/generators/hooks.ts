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
  void options;

  return {
    hooks: [
      {
        event: 'Stop',
        matcher: '',
        command:
          'echo "AgentMesa: when the task is implemented, set ' +
          '\\"mesa task status <id> ready_for_review\\" and request review with ' +
          'mesa_request_review."',
        description:
          'After Claude stops, remind to mark the task ready_for_review and request review.',
      },
    ],
  };
}
