import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createWorkspacePaths,
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  createMeeting,
  listMeetings,
  registerAgent,
  listAgents,
} from '@agentmesa/core';
import { resetTaskCounter, resetMessageCounter, resetMeetingCounter } from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';

let testDir: string;
let paths: MesaWorkspacePaths;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
  paths = initWorkspace(testDir);
  resetTaskCounter();
  resetMessageCounter();
  resetMeetingCounter();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('CLI integration: task workflow', () => {
  it('creates and lists tasks', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    expect(task.id).toBe('T-0001');

    const tasks = listTasks(paths);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Build feature');
  });

  it('updates task status through lifecycle', () => {
    const task = createTask(paths, { title: 'Build feature', createdBy: 'user' });
    const updated = updateTaskStatus(paths, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');

    const fetched = getTask(paths, task.id);
    expect(fetched.status).toBe('in_progress');
  });

  it('registers and lists agents', () => {
    registerAgent(paths, { id: 'claude', name: 'Claude Code', client: 'claude-code', roles: ['builder'] });
    registerAgent(paths, { id: 'codex', name: 'Codex', client: 'codex', roles: ['reviewer'] });

    const agents = listAgents(paths);
    expect(agents).toHaveLength(2);
  });

  it('creates meetings', () => {
    const meeting = createMeeting(paths, { title: 'Feature Review' });
    expect(meeting.id).toBe('MTG-0001');
    expect(meeting.status).toBe('open');

    const meetings = listMeetings(paths);
    expect(meetings).toHaveLength(1);
  });
});

describe('CLI integration: workspace init', () => {
  it('workspace directories exist after init', () => {
    expect(existsSync(paths.mesaDir)).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.meetingsDir)).toBe(true);
    expect(existsSync(join(paths.mesaDir, 'config.json'))).toBe(true);
  });

  it('config.json has correct protocol version', () => {
    const config = JSON.parse(readFileSync(join(paths.mesaDir, 'config.json'), 'utf-8'));
    expect(config.protocolVersion).toBe('0.1.0');
  });
});
