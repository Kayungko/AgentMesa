interface CommandCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

const SAFE_COMMANDS = [
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git show',
  'git stash list',
  'npm test',
  'npm run test',
  'pnpm test',
  'pnpm run test',
  'npx vitest run',
  'npx tsc --noEmit',
  'npx eslint',
  'cat',
  'ls',
  'pwd',
  'echo',
  'node --version',
  'npm --version',
  'pnpm --version',
];

const BLOCKED_COMMANDS = [
  { pattern: /rm\s+-rf\s+\//, reason: 'Recursive deletion of root paths is blocked' },
  { pattern: /rm\s+-rf\s+~/, reason: 'Recursive deletion of home directory is blocked' },
  { pattern: /\bsudo\b/, reason: 'Sudo commands are blocked' },
  { pattern: /\bgit\s+push\s+--force\b/, reason: 'Force push is blocked' },
  { pattern: /\bgit\s+push\s+-f\b/, reason: 'Force push is blocked' },
  { pattern: /\bgit\s+merge\b.*--no-ff/, reason: 'Merge without approval is blocked' },
  { pattern: /\bchmod\s+777\b/, reason: 'Overly permissive chmod is blocked' },
  { pattern: /\bmkfs\b/, reason: 'Filesystem formatting is blocked' },
  { pattern: /\bdd\s+if=/, reason: 'Raw disk write is blocked' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/, reason: 'Fork bomb is blocked' },
  { pattern: /\bshutdown\b/, reason: 'System shutdown is blocked' },
  { pattern: /\breboot\b/, reason: 'System reboot is blocked' },
];

const APPROVAL_REQUIRED_COMMANDS = [
  { pattern: /npm\s+install\s+.*--save/, reason: 'Adding production dependencies requires approval' },
  { pattern: /npm\s+add\b/, reason: 'Adding dependencies requires approval' },
  { pattern: /pnpm\s+add\b/, reason: 'Adding dependencies requires approval' },
  { pattern: /\brm\s+-r\b/, reason: 'Recursive file deletion requires approval' },
  { pattern: /\brm\s+--recursive\b/, reason: 'Recursive file deletion requires approval' },
  { pattern: /auth/i, reason: 'Modifying authentication code requires approval' },
  { pattern: /payment/i, reason: 'Modifying payment code requires approval' },
  { pattern: /deploy/i, reason: 'Modifying deployment code requires approval' },
  { pattern: /\bgit\s+push\b/, reason: 'Pushing code requires approval' },
  { pattern: /\bgit\s+merge\b/, reason: 'Merging branches requires approval' },
];

export class CommandPolicyChecker {
  isAllowed(command: string): CommandCheckResult {
    const trimmed = command.trim();

    for (const blocked of BLOCKED_COMMANDS) {
      if (blocked.pattern.test(trimmed)) {
        return { allowed: false, requiresApproval: false, reason: blocked.reason };
      }
    }

    for (const safe of SAFE_COMMANDS) {
      if (trimmed === safe || trimmed.startsWith(safe + ' ')) {
        return { allowed: true, requiresApproval: false };
      }
    }

    for (const approval of APPROVAL_REQUIRED_COMMANDS) {
      if (approval.pattern.test(trimmed)) {
        return { allowed: false, requiresApproval: true, reason: approval.reason };
      }
    }

    return { allowed: true, requiresApproval: false };
  }
}
