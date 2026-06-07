const DEFAULT_ALLOWLIST: string[] = [
  'npm test',
  'npm run build',
  'npm run lint',
  'npm run typecheck',
  'pnpm test',
  'pnpm build',
  'pnpm lint',
  'pnpm typecheck',
  'yarn test',
  'yarn build',
  'yarn lint',
  'yarn typecheck',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'node --version',
  'echo',
];

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:(){ :\|:& };:/,  // fork bomb
  /\bcurl\b.*\|\s*sh/,
  /\bwget\b.*\|\s*sh/,
  /\bsudo\b/,
  /\bchmod\s+777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bformat\b/,
];

export function isCommandAllowed(
  command: string,
  allowlist?: string[]
): boolean {
  const list = allowlist ?? DEFAULT_ALLOWLIST;
  const normalized = command.trim();

  // Check dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  // Check allowlist — exact match or starts with allowed prefix
  for (const allowed of list) {
    if (normalized === allowed || normalized.startsWith(allowed + ' ')) {
      return true;
    }
  }

  return false;
}

export function sanitizeCommand(command: string): string {
  return command
    .replace(/[;&|`$(){}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDefaultAllowlist(): string[] {
  return [...DEFAULT_ALLOWLIST];
}
