import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  createMeeting,
  listMeetings,
  registerAgent,
  listAgents,
} from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-cli-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('CLI integration: task workflow', () => {
  it('creates and lists tasks', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    expect(task.id).toMatch(/^task_/);

    const tasks = listTasks(ctx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Build feature');
  });

  it('updates task status through lifecycle', () => {
    const task = createTask(ctx, { title: 'Build feature' });
    const updated = updateTaskStatus(ctx, task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');

    const fetched = getTask(ctx, task.id);
    expect(fetched.status).toBe('in_progress');
  });

  it('registers and lists agents', () => {
    registerAgent(paths, { id: 'claude', name: 'Claude Code', client: 'claude-code', status: 'available', roles: ['builder'] });
    registerAgent(paths, { id: 'codex', name: 'Codex', client: 'codex', status: 'available', roles: ['reviewer'] });

    const agents = listAgents(paths);
    expect(agents).toHaveLength(2);
  });

  it('creates meetings', () => {
    const meeting = createMeeting(paths, { title: 'Feature Review' });
    expect(meeting.id).toMatch(/^meeting_/);
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
    expect(config.protocolVersion).toBe('0.2.0');
  });
});
