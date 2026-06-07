import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '@agentmesa/core';
import { DeskServer } from '../server.js';

let testDir: string;
let server: DeskServer;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-test-'));
  initWorkspace(testDir);
});

afterEach(async () => {
  if (server) {
    await server.stop();
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe('DeskServer', () => {
  it('constructor accepts rootDir and port', () => {
    server = new DeskServer(testDir, 3456);
    expect(server).toBeDefined();
  });

  it('starts and stops without error', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    expect(server.getPort()).toBeGreaterThan(0);
    await server.stop();
  });

  it('GET / returns HTML with AgentMesa content', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('AgentMesa');
  });

  it('GET /api/tasks returns JSON array', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/tasks`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/meetings returns JSON array', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/meetings`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/agents returns JSON array', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/agents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/status returns summary object', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/status`);
    const body = (await res.json()) as { tasks: number; meetings: number; agents: number; artifacts: number };

    expect(res.status).toBe(200);
    expect(typeof body.tasks).toBe('number');
    expect(typeof body.meetings).toBe('number');
    expect(typeof body.agents).toBe('number');
    expect(typeof body.artifacts).toBe('number');
  });

  it('GET /api/artifacts returns JSON array', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/artifacts`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const port = server.getPort();

    const res = await fetch(`http://localhost:${port}/api/unknown`);

    expect(res.status).toBe(404);
  });
});
