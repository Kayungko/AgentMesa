import type { AgentRole } from '@agentmesa/protocol';
import type { FileAccessRule } from './types.js';

const SECRET_PATH_PATTERNS = [
  /\.env/i,
  /\.ssh\//i,
  /credentials/i,
  /secrets?\//i,
  /keys?\//i,
  /tokens?\//i,
];

const DEFAULT_RULES: FileAccessRule[] = [
  {
    pattern: '**/*',
    allow: ['chair', 'builder', 'reviewer', 'tester', 'planner', 'documenter', 'maintainer'],
  },
  {
    pattern: '**/*.ts',
    allow: ['chair', 'builder', 'reviewer', 'tester', 'planner', 'documenter', 'maintainer'],
    deny: ['reviewer'],
  },
  {
    pattern: '**/*.js',
    allow: ['chair', 'builder', 'reviewer', 'tester', 'planner', 'documenter', 'maintainer'],
    deny: ['reviewer'],
  },
  {
    pattern: '.agentmesa/**',
    allow: ['chair', 'maintainer'],
    deny: ['builder', 'reviewer', 'tester', 'documenter', 'planner'],
  },
];

function matchPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  if (pattern === '**/*') return true;

  if (pattern.startsWith('**/*.') ) {
    const ext = pattern.slice(4);
    return normalized.endsWith(ext);
  }

  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return normalized.startsWith(prefix + '/') || normalized.startsWith(prefix);
  }

  return normalized === pattern || normalized.includes(pattern);
}

export class FileAccessChecker {
  private readonly rules: FileAccessRule[];

  constructor(rules?: FileAccessRule[]) {
    this.rules = rules ?? DEFAULT_RULES;
  }

  canAccess(filePath: string, role: AgentRole): boolean {
    let allowed = false;

    for (const rule of this.rules) {
      if (matchPattern(filePath, rule.pattern)) {
        if (rule.deny?.includes(role)) {
          return false;
        }
        if (rule.allow.includes(role)) {
          allowed = true;
        }
      }
    }

    return allowed;
  }

  isSecretPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  }
}
