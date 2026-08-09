import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import {
  addWorkspace,
  clearRegistry,
  getActiveWorkspace,
  getGlobalMesaDir,
  getWorkspace,
  listWorkspaces,
  readRegistry,
  removeWorkspace,
  setActiveWorkspace,
} from '../workspace-registry.js';
import { MesaError } from '../errors.js';

let homeDir: string;
let projectA: string;
let projectB: string;
const prevHome = process.env['AGENTMESA_HOME'];

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'agentmesa-home-'));
  projectA = mkdtempSync(join(tmpdir(), 'agentmesa-proj-a-'));
  projectB = mkdtempSync(join(tmpdir(), 'agentmesa-proj-b-'));
  initWorkspace(projectA);
  initWorkspace(projectB);
  process.env['AGENTMESA_HOME'] = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['AGENTMESA_HOME'];
  else process.env['AGENTMESA_HOME'] = prevHome;
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(projectA, { recursive: true, force: true });
  rmSync(projectB, { recursive: true, force: true });
});

describe('workspace registry', () => {
  it('resolves the global mesa dir from AGENTMESA_HOME', () => {
    expect(getGlobalMesaDir()).toBe(homeDir);
  });

  it('starts empty', () => {
    expect(listWorkspaces()).toEqual([]);
    expect(getActiveWorkspace()).toBeNull();
  });

  it('adds a workspace, deriving name from the dir basename and making it active', () => {
    const added = addWorkspace({ rootDir: projectA });
    expect(added.rootDir).toBe(projectA);
    expect(added.name).toBe(projectA.split(/[\\/]/).pop());
    expect(added.id).toMatch(/^ws_/);
    expect(getActiveWorkspace()?.id).toBe(added.id);
    expect(listWorkspaces()).toHaveLength(1);
  });

  it('adds a workspace with an explicit name', () => {
    const added = addWorkspace({ rootDir: projectA, name: 'Idel-Game' });
    expect(added.name).toBe('Idel-Game');
  });

  it('rejects adding an uninitialized directory', () => {
    const uninit = mkdtempSync(join(tmpdir(), 'agentmesa-uninit-'));
    try {
      expect(() => addWorkspace({ rootDir: uninit })).toThrow(MesaError);
      expect(() => addWorkspace({ rootDir: uninit })).toThrow(/mesa init/);
    } finally {
      rmSync(uninit, { recursive: true, force: true });
    }
  });

  it('is idempotent when adding the same rootDir twice', () => {
    const first = addWorkspace({ rootDir: projectA });
    const second = addWorkspace({ rootDir: projectA });
    expect(second.id).toBe(first.id);
    expect(listWorkspaces()).toHaveLength(1);
  });

  it('keeps the first workspace active, allows switching active', () => {
    const a = addWorkspace({ rootDir: projectA });
    const b = addWorkspace({ rootDir: projectB });
    expect(getActiveWorkspace()?.id).toBe(a.id);

    setActiveWorkspace(b.id);
    expect(getActiveWorkspace()?.id).toBe(b.id);

    // Persisted across a re-read
    expect(readRegistry().activeWorkspaceId).toBe(b.id);
  });

  it('removes a workspace and clears active if it was active', () => {
    const a = addWorkspace({ rootDir: projectA });
    const b = addWorkspace({ rootDir: projectB });
    setActiveWorkspace(a.id);
    removeWorkspace(a.id);
    expect(getWorkspace(a.id)).toBeNull();
    expect(getActiveWorkspace()?.id).toBe(b.id);
    expect(listWorkspaces()).toHaveLength(1);
  });

  it('throws on removing an unknown workspace', () => {
    expect(() => removeWorkspace('ws_unknown')).toThrow(MesaError);
  });

  it('throws on setting an unknown active workspace', () => {
    expect(() => setActiveWorkspace('ws_unknown')).toThrow(MesaError);
  });

  it('clearRegistry empties the registry', () => {
    addWorkspace({ rootDir: projectA });
    clearRegistry();
    expect(listWorkspaces()).toEqual([]);
  });
});
