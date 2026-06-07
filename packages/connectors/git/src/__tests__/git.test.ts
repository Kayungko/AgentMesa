import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  gitIsRepo,
  gitInit,
  gitCurrentBranch,
  gitCurrentCommit,
  gitStatus,
  gitChangedFiles,
  gitDiff,
  gitLog,
} from '../git.js';

let testDir: string;

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-git-test-'));
  gitInit(testDir);
  git(testDir, 'config user.email "test@test.com"');
  git(testDir, 'config user.name "Test"');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('gitIsRepo', () => {
  it('returns true for git repo', () => {
    expect(gitIsRepo(testDir)).toBe(true);
  });

  it('returns false for non-repo', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agentmesa-empty-'));
    try {
      expect(gitIsRepo(emptyDir)).toBe(false);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('gitStatus', () => {
  it('returns current branch', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    const status = gitStatus(testDir);
    expect(typeof status.currentBranch).toBe('string');
    expect(status.currentBranch.length).toBeGreaterThan(0);
  });

  it('detects untracked files', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    writeFileSync(join(testDir, 'new-file.txt'), 'new');
    const status = gitStatus(testDir);
    expect(status.untracked).toContain('new-file.txt');
  });

  it('detects changed files', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    writeFileSync(join(testDir, 'file.txt'), 'modified');
    const status = gitStatus(testDir);
    expect(status.changed).toContain('file.txt');
  });
});

describe('gitChangedFiles', () => {
  it('returns all changed and untracked files', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    writeFileSync(join(testDir, 'file.txt'), 'modified');
    writeFileSync(join(testDir, 'new.txt'), 'new');
    const files = gitChangedFiles(testDir);
    expect(files).toContain('file.txt');
    expect(files).toContain('new.txt');
  });
});

describe('gitDiff', () => {
  it('returns diff for modified files', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    writeFileSync(join(testDir, 'file.txt'), 'hello world');
    const diff = gitDiff(testDir);
    expect(diff).toContain('+hello world');
  });

  it('returns staged diff', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    writeFileSync(join(testDir, 'file.txt'), 'hello world');
    git(testDir, 'add .');
    const diff = gitDiff(testDir, { staged: true });
    expect(diff).toContain('+hello world');
  });
});

describe('gitLog', () => {
  it('returns log entries', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "first commit"');

    writeFileSync(join(testDir, 'file2.txt'), 'world');
    git(testDir, 'add .');
    git(testDir, 'commit -m "second commit"');

    const log = gitLog(testDir, 5);
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0]!.message).toBe('second commit');
  });
});

describe('gitCurrentCommit', () => {
  it('returns commit hash', () => {
    writeFileSync(join(testDir, 'file.txt'), 'hello');
    git(testDir, 'add .');
    git(testDir, 'commit -m "initial"');

    const hash = gitCurrentCommit(testDir);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });
});
