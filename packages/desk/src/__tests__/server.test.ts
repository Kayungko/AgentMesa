import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initWorkspace,
  createRuntimeContext,
  createTask,
  createAgentRun,
  createCheckResult,
  writeReviewRequest,
  appendMessage,
} from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { WorkflowEngine } from '@agentmesa/orchestrator';
import { DeskServer } from '../server.js';

let testDir: string;
let ctx: MesaRuntimeContext;
let server: DeskServer;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-desk-test-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
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

  it('GET /api/runs returns agent runs', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    createAgentRun(ctx, { agentId: 'builder-1', input: 'Implement X', taskId: task.id });

    server = new DeskServer(testDir, 0);
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/runs`);
    const body = (await res.json()) as Array<{ agentId: string }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]!.agentId).toBe('builder-1');
  });

  it('GET /api/workflows returns an empty array when no workflow ran', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/workflows`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('GET /api/handoffs returns outbound and inbound envelopes', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    writeReviewRequest(ctx, {
      taskId: task.id,
      runId: 'run_abc',
      artifactId: 'artifact_1',
      requestedReviewer: 'codex',
      summary: 'Please review',
    });

    server = new DeskServer(testDir, 0);
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/handoffs`);
    const body = (await res.json()) as { outbound: unknown[]; inbound: unknown[] };

    expect(res.status).toBe(200);
    expect(body.outbound).toHaveLength(1);
    expect(body.inbound).toEqual([]);
  });

  it('GET /api/checks returns check results', async () => {
    const task = createTask(ctx, { title: 'Build feature' });
    createCheckResult(ctx, { taskId: task.id, status: 'passed', checkName: 'Unit Tests', success: true });

    server = new DeskServer(testDir, 0);
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/checks`);
    const body = (await res.json()) as Array<{ checkName: string }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]!.checkName).toBe('Unit Tests');
  });

  it('GET /api/status includes runs, checks, and handoffs counts', async () => {
    server = new DeskServer(testDir, 0);
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/status`);
    const body = (await res.json()) as { runs: number; checks: number; handoffs: number };

    expect(res.status).toBe(200);
    expect(typeof body.runs).toBe('number');
    expect(typeof body.checks).toBe('number');
    expect(typeof body.handoffs).toBe('number');
  });

  it('protects API routes when a session token is configured', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const base = `http://localhost:${server.getPort()}`;

    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    expect((await fetch(`${base}/api/status`, {
      headers: { Authorization: 'Bearer secret' },
    })).status).toBe(200);
  });

  it('lists events incrementally after a cursor', async () => {
    const task = createTask(ctx, { title: 'Cursor task' });
    appendMessage(ctx, { taskId: task.id, type: 'general', summary: 'hello' });
    const events = ctx.eventStore.list();
    server = new DeskServer(testDir, 0);
    await server.start();

    const res = await fetch(`http://localhost:${server.getPort()}/api/events?cursor=${events[0]!.id}&limit=10`);
    const body = (await res.json()) as Array<{ cursor: string; event: { id: string } }>;

    expect(res.status).toBe(200);
    expect(body.map((item) => item.event.id)).toEqual(events.slice(1).map((event) => event.id));
    expect(body.at(-1)?.cursor).toBe(events.at(-1)?.id);
  });

  it('streams persisted and live events from another runtime context', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const controller = new AbortController();
    const response = await fetch(`http://localhost:${server.getPort()}/api/events/stream?access_token=secret`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();

    createTask(ctx, { title: 'Live event task' });
    const deadline = Date.now() + 3000;
    let text = '';
    while (!text.includes('task_created') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: mesa-event');
    expect(text).toContain('task_created');
  });

  it('falls back to a full replay when the stream cursor is unknown', async () => {
    createTask(ctx, { title: 'Replay task' });
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const controller = new AbortController();
    const response = await fetch(
      `http://localhost:${server.getPort()}/api/events/stream?access_token=secret&cursor=event_missing`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    const deadline = Date.now() + 3000;
    let text = '';
    while (!text.includes('task_created') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();

    expect(response.status).toBe(200);
    expect(text).toContain('task_created');
  });

  it('posts messages with correlation fields', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const res = await fetch(`http://localhost:${server.getPort()}/api/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'answer',
        summary: 'Approved',
        body: 'Proceed now',
        correlationId: 'corr_1',
        replyTo: 'request_1',
      }),
    });
    const body = (await res.json()) as { body: string; correlationId: string; replyTo: string };

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      body: 'Proceed now',
      correlationId: 'corr_1',
      replyTo: 'request_1',
    });
  });

  it('handles workflow decisions idempotently', async () => {
    const engine = new WorkflowEngine(ctx);
    const state = engine.startWorkflow({
      id: 'full-task-workflow',
      name: 'Approval',
      description: 'Approval',
      startStep: 'step-approve',
      steps: [
        {
          id: 'step-approve',
          type: 'human_approval',
          description: 'Approve',
          onSuccess: '__end__',
        },
      ],
    }, 'task-approval');
    await engine.executeStep(state);

    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const request = () => fetch(`http://localhost:${server.getPort()}/api/workflows/${state.workflowId}/decision`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ commandId: 'approve_1', decision: 'approve' }),
    });

    const [first, second] = await Promise.all([request(), request()]);
    const firstBody = (await first.json()) as { duplicate: boolean };
    const secondBody = (await second.json()) as { duplicate: boolean };

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect([firstBody.duplicate, secondBody.duplicate].sort()).toEqual([false, true]);
    expect(ctx.eventStore.list({ streamId: state.workflowId }).filter((event) => event.type === 'workflow_approved')).toHaveLength(1);
  });

  it('returns 400 for invalid message input', async () => {
    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();

    const res = await fetch(`http://localhost:${server.getPort()}/api/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'general' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects reuse of a command ID for different decision content', async () => {
    const engine = new WorkflowEngine(ctx);
    const state = engine.startWorkflow({
      id: 'full-task-workflow',
      name: 'Approval conflict',
      description: 'Approval conflict',
      startStep: 'step-approve',
      steps: [{
        id: 'step-approve',
        type: 'human_approval',
        description: 'Approve',
        onSuccess: '__end__',
      }],
    }, 'task-conflict');
    await engine.executeStep(state);

    server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
    await server.start();
    const url = `http://localhost:${server.getPort()}/api/workflows/${state.workflowId}/decision`;
    const headers = {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    };
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commandId: 'same-id', decision: 'approve' }),
    });
    const conflict = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commandId: 'same-id', decision: 'reject', reason: 'No' }),
    });

    expect(conflict.status).toBe(400);
  });

  describe('setup endpoints', () => {
    it('GET /api/setup/status returns the integration shape', async () => {
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/status`, {
        headers: { Authorization: 'Bearer secret' },
      });
      const body = (await res.json()) as {
        claude: { cliAvailable: boolean; mcpInstalled: boolean };
        codex: { cliAvailable: boolean; mcpInstalled: boolean };
        runners: Record<string, unknown>;
        runnerSources: { claude: string; codex: string };
      };

      expect(res.status).toBe(200);
      expect(typeof body.claude.cliAvailable).toBe('boolean');
      expect(typeof body.codex.cliAvailable).toBe('boolean');
      expect(['env', 'config', 'stub']).toContain(body.runnerSources.claude);
    });

    it('POST /api/setup/runners requires the session token', async () => {
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/runners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeCmd: 'claude -p' }),
      });

      expect(res.status).toBe(401);
    });

    it('POST /api/setup/runners is rejected when no session token is configured', async () => {
      server = new DeskServer(testDir, 0);
      await server.start();
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/runners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeCmd: 'claude -p' }),
      });

      expect(res.status).toBe(403);
    });

    it('POST /api/setup/runners persists commands to config.json', async () => {
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/runners`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ claudeCmd: 'claude -p', codexCmd: 'codex exec -' }),
      });
      const body = (await res.json()) as { claudeCmd?: string; codexCmd?: string };

      expect(res.status).toBe(200);
      expect(body).toEqual({ claudeCmd: 'claude -p', codexCmd: 'codex exec -' });

      const config = JSON.parse(readFileSync(join(testDir, '.agentmesa', 'config.json'), 'utf-8'));
      expect(config.runners).toEqual({ claudeCmd: 'claude -p', codexCmd: 'codex exec -' });
    });

    it('POST /api/setup/runners clears values with null', async () => {
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();
      const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };
      await fetch(`http://localhost:${server.getPort()}/api/setup/runners`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ codexCmd: 'codex exec -' }),
      });
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/runners`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ codexCmd: null }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
    });

    it('POST /api/setup/install rejects an unknown side', async () => {
      server = new DeskServer(testDir, 0, { sessionToken: 'secret' });
      await server.start();
      const res = await fetch(`http://localhost:${server.getPort()}/api/setup/install`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ side: 'cursor' }),
      });

      expect(res.status).toBe(400);
    });
  });
});
