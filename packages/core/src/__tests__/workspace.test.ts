import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  isWorkspaceInitialized,
  loadConfig,
  createWorkspacePaths,
} from '../workspace.js';
import { WorkspaceAlreadyExistsError, WorkspaceNotFoundError } from '../errors.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('initWorkspace', () => {
  it('creates .agentmesa directory structure', () => {
    const paths = initWorkspace(testDir);

    expect(existsSync(paths.mesaDir)).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.messagesDir)).toBe(true);
    expect(existsSync(paths.artifactsDir)).toBe(true);
    expect(existsSync(paths.meetingsDir)).toBe(true);
    expect(existsSync(paths.agentsDir)).toBe(true);
    expect(existsSync(paths.logsDir)).toBe(true);
    expect(existsSync(paths.locksDir)).toBe(true);
  });

  it('creates config.json', () => {
    const paths = initWorkspace(testDir);
    expect(existsSync(join(paths.mesaDir, 'config.json'))).toBe(true);
  });

  it('throws if already initialized', () => {
    initWorkspace(testDir);
    expect(() => initWorkspace(testDir)).toThrow(WorkspaceAlreadyExistsError);
  });
});

describe('isWorkspaceInitialized', () => {
  it('returns false for empty directory', () => {
    expect(isWorkspaceInitialized(testDir)).toBe(false);
  });

  it('returns true after init', () => {
    initWorkspace(testDir);
    expect(isWorkspaceInitialized(testDir)).toBe(true);
  });
});

describe('loadConfig', () => {
  it('returns config after init', () => {
    initWorkspace(testDir);
    const config = loadConfig(testDir);
    expect(config.protocolVersion).toBe('0.2.0');
  });

  it('throws if not initialized', () => {
    expect(() => loadConfig(testDir)).toThrow(WorkspaceNotFoundError);
  });
});

describe('createWorkspacePaths', () => {
  it('creates correct path structure', () => {
    const paths = createWorkspacePaths(testDir);
    expect(paths.mesaDir).toContain('.agentmesa');
    expect(paths.tasksDir).toContain('tasks');
    expect(paths.messagesDir).toContain('messages');
    expect(paths.artifactsDir).toContain('artifacts');
    expect(paths.meetingsDir).toContain('meetings');
    expect(paths.agentsDir).toContain('agents');
  });
});
