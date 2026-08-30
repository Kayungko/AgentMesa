import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace, createTask, registerAgent } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { MesaAgentRun, TransportEnvelope, MesaEvent, MesaCheckResult, MesaArtifact } from '@agentmesa/protocol';
import {
  handleCreateRun,
  handleListRuns,
  handleReadRun,
  handleUpdateRunStatus,
  handleExecRun,
  handleAttachArtifact,
  handleListWorkflows,
  handleReadWorkflow,
  handleRunWorkflow,
  handleRequestHandoff,
  handleSubmitHandoffResult,
  handleListHandoffs,
  handleListEvents,
  handleGetTaskEvents,
  handleGetTaskProjection,
  handleWhyTask,
  handleWhyMeeting,
  handleCreateCheck,
  handleListChecks,
  handleGetCheck,
} from '../tools.js';
import { resolveActor } from '../server.js';

let testDir: string;
let ctx: MesaRuntimeContext;
let taskId: string;

const SAVED_ID = process.env.AGENTMESA_MCP_ACTOR_ID;
const SAVED_ROLES = process.env.AGENTMESA_MCP_ACTOR_ROLES;

function parse<T>(result: string): T {
  return JSON.parse(result) as T;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-mcp-runtime-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'agent:mcp', type: 'agent', roles: ['builder'], client: 'mcp' },
  });
  taskId = createTask(ctx, { title: 'Build feature', createdBy: 'agent:mcp' }).id;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  if (SAVED_ID === undefined) delete process.env.AGENTMESA_MCP_ACTOR_ID;
  else process.env.AGENTMESA_MCP_ACTOR_ID = SAVED_ID;
  if (SAVED_ROLES === undefined) delete process.env.AGENTMESA_MCP_ACTOR_ROLES;
  else process.env.AGENTMESA_MCP_ACTOR_ROLES = SAVED_ROLES;
});

describe('resolveActor', () => {
  it('defaults to agent:mcp / builder when env is unset', () => {
    delete process.env.AGENTMESA_MCP_ACTOR_ID;
    delete process.env.AGENTMESA_MCP_ACTOR_ROLES;
    const actor = resolveActor();
    expect(actor.id).toBe('agent:mcp');
    expect(actor.type).toBe('agent');
    expect(actor.roles).toEqual(['builder']);
    expect(actor.client).toBe('mcp');
  });

  it('reads id and comma-separated roles from env', () => {
    process.env.AGENTMESA_MCP_ACTOR_ID = 'agent:claude';
    process.env.AGENTMESA_MCP_ACTOR_ROLES = 'owner, builder ';
    const actor = resolveActor();
    expect(actor.id).toBe('agent:claude');
    expect(actor.roles).toEqual(['owner', 'builder']);
  });
});

describe('agent run tools', () => {
  it('creates, reads, lists, and updates a run', () => {
    const run = parse<MesaAgentRun>(
      handleCreateRun(ctx, { agentId: 'builder-1', input: 'Implement X', taskId })
    );
    expect(run.id).toMatch(/^run_/);
    expect(run.status).toBe('pending');

    const read = parse<MesaAgentRun>(handleReadRun(ctx, { runId: run.id }));
    expect(read.id).toBe(run.id);

    const byTask = parse<MesaAgentRun[]>(handleListRuns(ctx, { taskId }));
    expect(byTask).toHaveLength(1);
    const byStatus = parse<MesaAgentRun[]>(handleListRuns(ctx, { status: 'completed' }));
    expect(byStatus).toHaveLength(0);

    const running = parse<MesaAgentRun>(
      handleUpdateRunStatus(ctx, { runId: run.id, status: 'running' })
    );
    expect(running.status).toBe('running');
  });

  it('executes a run via the stub when no CLI env is set', async () => {
    const run = parse<MesaAgentRun>(
      handleCreateRun(ctx, { agentId: 'builder-1', input: 'Implement X', taskId })
    );
    const result = parse<{ run: MesaAgentRun }>(
      await handleExecRun(ctx, { runId: run.id })
    );
    expect(result.run.status).toBe('completed');
    expect(result.run.producedArtifactIds.length).toBeGreaterThan(0);
  });

  it('keeps the CLI path when AGENTMESA_DRIVER=cli, even for a claude-client agent', async () => {
    // `cli` explicitly disables deep drivers: the call site passes an empty
    // registry, so even a registered claude-code agent runs on the legacy
    // (stub) CLI runner — byte-for-byte the pre-M4 behavior.
    const prevDriverEnv = process.env.AGENTMESA_DRIVER;
    process.env.AGENTMESA_DRIVER = 'cli';
    try {
      registerAgent(ctx, {
        id: 'agent:claude',
        name: 'Claude',
        client: 'claude-code',
        status: 'available',
        roles: ['builder'],
      });
      const run = parse<MesaAgentRun>(
        handleCreateRun(ctx, { agentId: 'agent:claude', input: 'Implement X', taskId })
      );
      const result = parse<{ run: MesaAgentRun }>(
        await handleExecRun(ctx, { runId: run.id })
      );
      expect(result.run.status).toBe('completed');
      expect(result.run.producedArtifactIds.length).toBeGreaterThan(0);
    } finally {
      if (prevDriverEnv === undefined) delete process.env.AGENTMESA_DRIVER;
      else process.env.AGENTMESA_DRIVER = prevDriverEnv;
    }
  });
});

describe('workflow tools', () => {
  it('lists and reads workflow definitions', () => {
    const ids = parse<string[]>(handleListWorkflows());
    expect(ids).toContain('review-fix-loop');

    const def = parse<{ id: string; steps: unknown[] }>(
      handleReadWorkflow(ctx, { workflowId: 'review-fix-loop' })
    );
    expect(def.id).toBe('review-fix-loop');
    expect(def.steps.length).toBeGreaterThan(0);
  });

  it('runs a workflow to a terminal state', async () => {
    const state = parse<{ status: string; taskId: string }>(
      await handleRunWorkflow(ctx, { workflowId: 'review-fix-loop', taskId })
    );
    expect(state.taskId).toBe(taskId);
    expect(['completed', 'failed', 'waiting_approval']).toContain(state.status);
  });
});

describe('handoff tools', () => {
  it('writes and lists request/result envelopes', () => {
    // Handoffs must reference real entities — ghost ids are rejected.
    const run = parse<MesaAgentRun>(
      handleCreateRun(ctx, { agentId: 'builder-1', input: 'Implement X', taskId })
    );
    const artifact = parse<MesaArtifact>(
      handleAttachArtifact(ctx, {
        kind: 'implementation_summary',
        taskId,
        createdBy: 'agent:mcp',
        content: 'Implementation complete',
      })
    );

    const req = parse<TransportEnvelope>(
      handleRequestHandoff(ctx, {
        taskId,
        runId: run.id,
        artifactId: artifact.id,
        requestedReviewer: 'codex',
        summary: 'Please review',
      })
    );
    expect(req.type).toBe('review_request');

    const res = parse<TransportEnvelope>(
      handleSubmitHandoffResult(ctx, {
        taskId,
        runId: run.id,
        artifactId: artifact.id,
        reviewer: 'codex',
        summary: 'LGTM',
        verdict: 'approved',
      })
    );
    expect(res.type).toBe('review_result');

    const lists = parse<{ outbound: TransportEnvelope[]; inbound: TransportEnvelope[] }>(
      handleListHandoffs(ctx)
    );
    expect(lists.outbound).toHaveLength(1);
    expect(lists.inbound).toHaveLength(1);
  });

  it('rejects handoffs referencing unknown runs or artifacts', () => {
    const run = parse<MesaAgentRun>(
      handleCreateRun(ctx, { agentId: 'builder-1', input: 'Implement X', taskId })
    );
    expect(() =>
      handleRequestHandoff(ctx, {
        taskId,
        runId: 'run_ghost',
        artifactId: 'artifact_ghost',
        requestedReviewer: 'codex',
        summary: 'Please review',
      })
    ).toThrow(/Agent run not found/);
    expect(() =>
      handleSubmitHandoffResult(ctx, {
        taskId,
        runId: run.id,
        artifactId: 'artifact_ghost',
        reviewer: 'codex',
        summary: 'LGTM',
        verdict: 'approved',
      })
    ).toThrow(/Artifact not found/);
  });
});

describe('event / projection tools', () => {
  it('reflects a created task in the event stream', () => {
    const all = parse<MesaEvent[]>(handleListEvents(ctx, {}));
    expect(all.length).toBeGreaterThan(0);

    const taskEvents = parse<MesaEvent[]>(handleGetTaskEvents(ctx, { taskId }));
    expect(taskEvents.every((e) => e.streamId === taskId)).toBe(true);
  });

  it('returns null projection lookups without throwing', () => {
    const proj = parse<unknown>(handleGetTaskProjection(ctx, { taskId }));
    expect(proj === null || typeof proj === 'object').toBe(true);
  });
});

describe('why (causal explanation) tools', () => {
  it('explains a fresh task with a status chain and a not-started blocker', () => {
    const result = parse<{
      entityType: string;
      taskId: string;
      currentStatus: string;
      statusChain: Array<{ to: string; cause: { confidence: string } }>;
      blocker: { kind: string; confidence: string };
      timeline: unknown[];
    }>(handleWhyTask(ctx, { taskId }));
    expect(result.entityType).toBe('task');
    expect(result.taskId).toBe(taskId);
    expect(result.currentStatus).toBe('todo');
    expect(result.statusChain.length).toBeGreaterThan(0);
    expect(result.statusChain[0]?.to).toBe('todo');
    expect(result.blocker.kind).toBe('not_started');
    expect(result.timeline.length).toBeGreaterThan(0);
  });

  it('rejects unknown task ids loudly', () => {
    expect(() => handleWhyTask(ctx, { taskId: 'T-does-not-exist' })).toThrow(
      /Task not found/
    );
  });

  it('rejects unknown meeting ids loudly', () => {
    expect(() => handleWhyMeeting(ctx, { meetingId: 'm-does-not-exist' })).toThrow(
      /Meeting not found/
    );
  });
});

describe('check result tools', () => {
  it('creates, reads, and lists check results', () => {
    const created = parse<MesaCheckResult>(
      handleCreateCheck(ctx, {
        taskId,
        status: 'passed',
        checkName: 'Unit Tests',
        success: true,
      })
    );
    expect(created.id).toMatch(/^check_/);
    expect(created.status).toBe('passed');

    const read = parse<MesaCheckResult>(handleGetCheck(ctx, { checkId: created.id }));
    expect(read.id).toBe(created.id);

    const byTask = parse<MesaCheckResult[]>(handleListChecks(ctx, { taskId }));
    expect(byTask).toHaveLength(1);
    const byStatus = parse<MesaCheckResult[]>(handleListChecks(ctx, { status: 'failed' }));
    expect(byStatus).toHaveLength(0);
  });
});
