export interface ParsedArgs {
  command: string;
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'json' || key === 'help' || key === 'quiet') {
        flags[key] = true;
      } else if (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        flags[key] = args[i + 1]!;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      if (key === 'h') {
        flags['help'] = true;
      } else if (key === 'j') {
        flags['json'] = true;
      } else if (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        flags[key] = args[i + 1]!;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return {
    command: positional[0] ?? 'help',
    subcommand: positional[1] ?? '',
    positional: positional.slice(2),
    flags,
  };
}
