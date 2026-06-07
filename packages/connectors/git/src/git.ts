import { execSync } from 'node:child_process';

export interface GitStatus {
  currentBranch: string;
  changed: string[];
  untracked: string[];
  staged: string[];
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface DiffOptions {
  staged?: boolean;
  ref?: string;
  pathspec?: string;
}

function exec(cwd: string, command: string): string {
  try {
    return execSync(command, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer | string };
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() ?? '';
    throw new Error(`Git command failed: ${command}\n${stderr}`);
  }
}

export function gitCurrentBranch(cwd: string): string {
  return exec(cwd, 'git rev-parse --abbrev-ref HEAD');
}

export function gitCurrentCommit(cwd: string): string {
  return exec(cwd, 'git rev-parse HEAD');
}

export function gitShortCommit(cwd: string): string {
  return exec(cwd, 'git rev-parse --short HEAD');
}

export function gitStatus(cwd: string): GitStatus {
  const output = exec(cwd, 'git status --porcelain=v2 --branch');
  const lines = output.split('\n').filter(Boolean);

  let currentBranch = '';
  const changed: string[] = [];
  const untracked: string[] = [];
  const staged: string[] = [];
  let ahead = 0;
  let behind = 0;

  for (const line of lines) {
    if (line.startsWith('# branch.head')) {
      currentBranch = line.split(' ').slice(2).join(' ');
    } else if (line.startsWith('# branch.ab')) {
      const parts = line.split(' ');
      ahead = parseInt(parts[3] ?? '0', 10);
      behind = parseInt(parts[5] ?? '0', 10);
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Modified files
      const xy = line.substring(2, 4);
      const path = line.split(' ').pop() ?? '';
      if (xy[0] !== '.') staged.push(path);
      if (xy[1] !== '.') changed.push(path);
    } else if (line.startsWith('? ')) {
      untracked.push(line.slice(2));
    }
  }

  return { currentBranch, changed, untracked, staged, ahead, behind };
}

export function gitChangedFiles(cwd: string): string[] {
  const status = gitStatus(cwd);
  return [...new Set([...status.changed, ...status.untracked, ...status.staged])];
}

export function gitDiff(cwd: string, options: DiffOptions = {}): string {
  let cmd = 'git diff';
  if (options.staged) cmd += ' --cached';
  if (options.ref) cmd += ` ${options.ref}`;
  if (options.pathspec) cmd += ` -- ${options.pathspec}`;
  return exec(cwd, cmd);
}

export function gitLog(cwd: string, n = 10): GitLogEntry[] {
  const format = '%H%n%s%n%an%n%aI';
  const output = exec(cwd, `git log -${n} --format="${format}"`);
  if (!output) return [];

  const lines = output.split('\n');
  const entries: GitLogEntry[] = [];

  for (let i = 0; i < lines.length; i += 4) {
    const hash = lines[i];
    const message = lines[i + 1];
    const author = lines[i + 2];
    const date = lines[i + 3];
    if (hash && message && author && date) {
      entries.push({ hash, message, author, date });
    }
  }

  return entries;
}

export function gitCreateBranch(cwd: string, name: string, base?: string): void {
  const baseRef = base ?? 'HEAD';
  exec(cwd, `git checkout -b ${name} ${baseRef}`);
}

export function gitIsRepo(cwd: string): boolean {
  try {
    exec(cwd, 'git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

export function gitInit(cwd: string): void {
  exec(cwd, 'git init');
}
