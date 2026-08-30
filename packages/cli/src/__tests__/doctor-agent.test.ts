import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRuntimeContext,
  createRoomStore,
  createTask,
  initWorkspace,
  registerAgent,
} from '@agentmesa/core';
import { runDoctor } from '../commands/doctor.js';
import type { ParsedArgs } from '../parse-args.js';
import type { ExecFn, ExecResult } from '@agentmesa/setup';

let testDir: string;
let globalDir: string;
let prevAgentMesaHome: string | undefined;

/** ExecFn stub: no CLI available (ENOENT) so stdio registration reports a warning. */
const noCliExec: ExecFn = (_command, _args): ExecResult => ({
  status: null,
  stdout: '',
  stderr: '',
  error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
});

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'doctor',
    subcommand: '',
    positional: [],
    flags: {},
    ...overrides,
  };
}

function runSelfCheck(
  flags: ParsedArgs['flags'],
  env: Record<string, string | undefined> = {},
  exec: ExecFn = noCliExec,
): { stdout: string; exitCode: number } {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const prevExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    runDoctor(makeArgs({ flags: { 'as-agent': true, ...flags } }), { env, exec });
    return {
      stdout: logSpy.mock.calls.map((c) => c.join(' ')).join('\n'),
      exitCode: process.exitCode,
    };
  } finally {
    process.exitCode = prevExitCode;
    logSpy.mockRestore();
  }
}

function parseJson(stdout: string): {
  mode: string;
  actor: { id: string; agentId: string; source: string };
  checks: Array<{
    group: string;
    name: string;
    status: string;
    message: string;
    detail?: Record<string, unknown>;
    recommendation?: string;
  }>;
  summary: { total: number; pass: number; warn: number; fail: number };
} {
  return JSON.parse(stdout) as ReturnType<typeof parseJson>;
}

/** Recursive file snapshot (path -> size+mtime) to prove the self-check is read-only. */
function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        out.set(full, st.size + st.mtimeMs);
      }
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-doctor-agent-'));
  globalDir = mkdtempSync(join(tmpdir(), 'agentmesa-doctor-agent-global-'));
  prevAgentMesaHome = process.env['AGENTMESA_HOME'];
  process.env['AGENTMESA_HOME'] = globalDir;
});

afterEach(() => {
  if (prevAgentMesaHome === undefined) {
    delete process.env['AGENTMESA_HOME'];
  } else {
    process.env['AGENTMESA_HOME'] = prevAgentMesaHome;
  }
  rmSync(testDir, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
});

describe('doctor --as-agent: happy path', () => {
  it('reports a fully registered agent with rooms and events as JSON', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    createTask(ownerCtx, { title: 'Self-check task' });

    const rooms = createRoomStore(globalDir);
    const room = rooms.createRoom({ name: 'Dev Room' });
    rooms.invite(room.id, { workspaceId: 'local', kind: 'agent', ref: 'codex', label: 'Codex' });

    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const result = runSelfCheck(
        { json: true, actor: 'agent:codex' },
        { AGENTMESA_MCP_ACTOR_ID: 'agent:codex' },
      );
      const report = parseJson(result.stdout);

      expect(report.mode).toBe('as-agent');
      expect(report.actor).toEqual({ id: 'agent:codex', agentId: 'codex', source: 'flag' });

      const byName = (name: string) => report.checks.filter((c) => c.name === name);
      const registered = byName('agent-registered');
      expect(registered).toHaveLength(1);
      expect(registered[0]!.status).toBe('pass');
      expect(registered[0]!.message).toContain('Codex');

      const roomCheck = byName('room-membership');
      expect(roomCheck[0]!.status).toBe('pass');
      expect(roomCheck[0]!.message).toContain('Dev Room');

      const caps = byName('capability-matrix')[0]!;
      expect(caps.status).toBe('warn'); // reviewer: some probes denied, core verbs allowed
      const detail = caps.detail as {
        allowed: Array<{ action: string }>;
        denied: Array<{ action: string; reason: string }>;
      };
      const allowedActions = detail.allowed.map((a) => a.action);
      const deniedActions = detail.denied.map((a) => a.action);
      expect(allowedActions).toContain('message.append');
      expect(allowedActions).toContain('room.message.append');
      expect(allowedActions).toContain('handoff.write'); // request review
      expect(allowedActions).toContain('check.create'); // run checks
      expect(deniedActions).toContain('task.create'); // reviewer lacks write_task
      expect(deniedActions).toContain('room.invite'); // reviewer lacks manage_rooms
      expect(detail.denied[0]!.reason).toBeTruthy();

      expect(byName('reviewer-status-gate')[0]!.status).toBe('pass');

      const continuity = byName('event-cursor-continuity')[0]!;
      expect(continuity.status).toBe('pass');

      expect(report.summary.fail).toBe(0);
      expect(report.summary.total).toBe(report.checks.length);
      expect(result.exitCode).toBe(0);
    } finally {
      process.cwd = origCwd;
    }
  });

  it('is strictly read-only (no file changes in workspace or global home)', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });
    createTask(ownerCtx, { title: 'Read-only task' });
    const rooms = createRoomStore(globalDir);
    const room = rooms.createRoom({ name: 'Read-only Room' });
    rooms.invite(room.id, { workspaceId: 'local', kind: 'agent', ref: 'codex' });

    const before = snapshot(testDir);
    const globalBefore = snapshot(globalDir);

    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      runSelfCheck({ actor: 'agent:codex' }, { AGENTMESA_MCP_ACTOR_ID: 'agent:codex' });
    } finally {
      process.cwd = origCwd;
    }

    expect([...snapshot(testDir).entries()]).toEqual([...before.entries()]);
    expect([...snapshot(globalDir).entries()]).toEqual([...globalBefore.entries()]);
  });

  it('renders grouped human-readable output with PASS/FAIL markers', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const origCwd = process.cwd;
      process.cwd = () => testDir;
      runDoctor(makeArgs({ flags: { 'as-agent': true, actor: 'agent:codex' } }), {
        env: {},
        exec: noCliExec,
      });
      process.cwd = origCwd;

      const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(stdout).toContain('Agent Self-Check');
      expect(stdout).toContain('Actor: agent:codex');
      expect(stdout).toContain('[Workspace]');
      expect(stdout).toContain('[Identity registration]');
      expect(stdout).toContain('[Permissions & capabilities]');
      expect(stdout).toContain('PASS');
      expect(stdout).toContain('WARN');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe('doctor --as-agent: identity resolution', () => {
  it('fails with a fix hint when no actor id is given', () => {
    initWorkspace(testDir);
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const result = runSelfCheck({ json: true }, {});
      const report = parseJson(result.stdout);
      expect(report.actor.source).toBe('none');
      const resolvable = report.checks.find((c) => c.name === 'actor-id-resolvable');
      expect(resolvable!.status).toBe('fail');
      expect(resolvable!.recommendation).toContain('--actor');
      expect(resolvable!.recommendation).toContain('AGENTMESA_MCP_ACTOR_ID');
      expect(result.exitCode).toBe(1);
    } finally {
      process.cwd = origCwd;
    }
  });

  it('resolves the actor from AGENTMESA_MCP_ACTOR_ID env when no flag is given', () => {
    initWorkspace(testDir);
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const report = parseJson(runSelfCheck({ json: true }, { AGENTMESA_MCP_ACTOR_ID: 'agent:codex' }).stdout);
      expect(report.actor).toEqual({ id: 'agent:codex', agentId: 'codex', source: 'env' });
    } finally {
      process.cwd = origCwd;
    }
  });

  it('fails with the register command when the agent is unregistered', () => {
    initWorkspace(testDir);
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const result = runSelfCheck({ json: true, actor: 'agent:ghost' }, {});
      const report = parseJson(result.stdout);
      const registered = report.checks.find((c) => c.name === 'agent-registered');
      expect(registered!.status).toBe('fail');
      expect(registered!.recommendation).toContain('mesa agent add ghost');

      const caps = report.checks.find((c) => c.name === 'capability-matrix');
      expect(caps!.status).toBe('fail');
      expect(report.summary.fail).toBeGreaterThan(0);
      expect(result.exitCode).toBe(1);
    } finally {
      process.cwd = origCwd;
    }
  });

  it('warns on role drift between the registry and AGENTMESA_MCP_ACTOR_ROLES', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['reviewer'],
    });
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const report = parseJson(
        runSelfCheck(
          { json: true, actor: 'agent:codex' },
          { AGENTMESA_MCP_ACTOR_ROLES: 'builder' },
        ).stdout,
      );
      const drift = report.checks.find((c) => c.name === 'role-drift');
      expect(drift!.status).toBe('warn');
      expect(drift!.message).toContain('drift');
    } finally {
      process.cwd = origCwd;
    }
  });
});

describe('doctor --as-agent: workspace group', () => {
  it('fails every downstream group when the workspace is missing', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agentmesa-doctor-agent-empty-'));
    const origCwd = process.cwd;
    process.cwd = () => emptyDir;
    try {
      const result = runSelfCheck({ json: true, actor: 'agent:codex' }, {});
      const report = parseJson(result.stdout);
      const initialized = report.checks.find((c) => c.name === 'workspace-initialized');
      expect(initialized!.status).toBe('fail');
      expect(initialized!.recommendation).toContain('mesa init');
      expect(result.exitCode).toBe(1);
    } finally {
      process.cwd = origCwd;
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('fails on an unsupported protocol version and warns on a migratable one', () => {
    const cases: Array<{ version: string; expected: string }> = [
      { version: '9.9.9', expected: 'fail' },
      { version: '0.1.0', expected: 'warn' },
    ];
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      for (const { version, expected } of cases) {
        initWorkspace(testDir);
        const configPath = join(testDir, '.agentmesa', 'config.json');
        const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        config.protocolVersion = version;
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

        const report = parseJson(runSelfCheck({ json: true, actor: 'agent:codex' }, {}).stdout);
        const versionCheck = report.checks.find((c) => c.name === 'protocol-version');
        expect(versionCheck!.status).toBe(expected);

        rmSync(join(testDir, '.agentmesa'), { recursive: true, force: true });
      }
    } finally {
      process.cwd = origCwd;
    }
  });

  it('warns when no room membership exists', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    registerAgent(ownerCtx, {
      id: 'codex',
      name: 'Codex',
      client: 'codex',
      status: 'available',
      roles: ['builder'],
    });
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const report = parseJson(runSelfCheck({ json: true, actor: 'agent:codex' }, {}).stdout);
      const rooms = report.checks.find((c) => c.name === 'room-membership');
      expect(rooms!.status).toBe('warn');
      expect(rooms!.recommendation).toContain('mesa_invite_to_room');
    } finally {
      process.cwd = origCwd;
    }
  });
});

describe('doctor --as-agent: MCP channel group', () => {
  beforeEach(() => {
    initWorkspace(testDir);
  });

  function withCwd(run: () => void): void {
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      run();
    } finally {
      process.cwd = origCwd;
    }
  }

  it('warns when no CLI has the stdio MCP registered and the actor env is unset', () => {
    withCwd(() => {
      const report = parseJson(runSelfCheck({ json: true, actor: 'agent:codex' }, {}).stdout);
      const stdio = report.checks.find((c) => c.name === 'stdio-registration');
      expect(stdio!.status).toBe('warn');
      expect(stdio!.recommendation).toContain('mesa plugin install');
      const binding = report.checks.find((c) => c.name === 'stdio-actor-binding');
      expect(binding!.status).toBe('warn');
      expect(binding!.message).toContain('agent:mcp');
    });
  });

  it('passes stdio registration when a CLI reports the MCP server', () => {
    const okExec: ExecFn = (_command, _args): ExecResult => ({
      status: 0,
      stdout: 'agentmesa',
      stderr: '',
    });
    withCwd(() => {
      const report = parseJson(
        runSelfCheck({ json: true, actor: 'agent:codex' }, { AGENTMESA_MCP_ACTOR_ID: 'agent:codex' }, okExec).stdout,
      );
      const stdio = report.checks.find((c) => c.name === 'stdio-registration');
      expect(stdio!.status).toBe('pass');
      const binding = report.checks.find((c) => c.name === 'stdio-actor-binding');
      expect(binding!.status).toBe('pass');
    });
  });

  it('warns on http mode with non-loopback host, missing token, and invalid port', () => {
    withCwd(() => {
      const report = parseJson(
        runSelfCheck(
          { json: true, actor: 'agent:codex' },
          {
            AGENTMESA_MCP_TRANSPORT: 'http',
            AGENTMESA_HTTP_HOST: '0.0.0.0',
            AGENTMESA_HTTP_PORT: '99999',
          },
        ).stdout,
      );
      const host = report.checks.find((c) => c.name === 'http-transport');
      expect(host!.status).toBe('warn');
      expect(host!.message).toContain('0.0.0.0');
      const token = report.checks.find((c) => c.name === 'http-auth-token');
      expect(token!.status).toBe('warn');
      const port = report.checks.find((c) => c.name === 'http-port');
      expect(port!.status).toBe('fail');
    });
  });

  it('passes http mode checks for loopback + token + valid port', () => {
    withCwd(() => {
      const report = parseJson(
        runSelfCheck(
          { json: true, actor: 'agent:codex' },
          {
            AGENTMESA_MCP_TRANSPORT: 'http',
            AGENTMESA_HTTP_HOST: '127.0.0.1',
            AGENTMESA_HTTP_TOKEN: 'secret-token',
            AGENTMESA_HTTP_PORT: '8765',
          },
        ).stdout,
      );
      expect(report.checks.find((c) => c.name === 'http-transport')!.status).toBe('pass');
      expect(report.checks.find((c) => c.name === 'http-auth-token')!.status).toBe('pass');
      expect(report.checks.find((c) => c.name === 'http-port')!.status).toBe('pass');
    });
  });

  it('warns on an invalid AGENTMESA_MCP_TRANSPORT value', () => {
    withCwd(() => {
      const report = parseJson(
        runSelfCheck({ json: true, actor: 'agent:codex' }, { AGENTMESA_MCP_TRANSPORT: 'grpc' }).stdout,
      );
      const transport = report.checks.find((c) => c.name === 'http-transport');
      expect(transport!.status).toBe('warn');
      expect(transport!.message).toContain('grpc');
    });
  });
});

describe('doctor --as-agent: event stream group', () => {
  it('fails on corrupted event log lines', () => {
    initWorkspace(testDir);
    const eventsFile = join(testDir, '.agentmesa', 'events', 'events.jsonl');
    writeFileSync(eventsFile, 'not-valid-json{{{\n', 'utf-8');
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const report = parseJson(runSelfCheck({ json: true, actor: 'agent:codex' }, {}).stdout);
      const logChecks = report.checks.filter((c) => c.name === 'event-log');
      expect(logChecks.some((c) => c.status === 'fail')).toBe(true);
    } finally {
      process.cwd = origCwd;
    }
  });

  it('fails on per-stream sequence gaps (cursor continuity)', () => {
    initWorkspace(testDir);
    const ownerCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'user:local', type: 'user', roles: ['owner'] },
    });
    const task = createTask(ownerCtx, { title: 'Gap task' });
    const eventsFile = join(testDir, '.agentmesa', 'events', 'events.jsonl');
    const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n');
    const taskEvent = lines
      .map((line) => JSON.parse(line) as { sequence: number; streamId: string })
      .find((e) => e.streamId === task.id);
    expect(taskEvent).toBeDefined();
    // Rewrite the log with the task stream only, sequence gap: 0 then 2.
    const first = { ...taskEvent!, sequence: 0 };
    const gapped = { ...taskEvent!, sequence: 2 };
    writeFileSync(eventsFile, `${JSON.stringify(first)}\n${JSON.stringify(gapped)}\n`, 'utf-8');

    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const report = parseJson(runSelfCheck({ json: true, actor: 'agent:codex' }, {}).stdout);
      const continuity = report.checks.find((c) => c.name === 'event-cursor-continuity');
      expect(continuity!.status).toBe('fail');
      expect(continuity!.message).toContain(task.id);
    } finally {
      process.cwd = origCwd;
    }
  });
});

describe('doctor: default mode unchanged', () => {
  it('runs the host-environment check (not the agent self-check) without --as-agent', () => {
    initWorkspace(testDir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const origCwd = process.cwd;
      process.cwd = () => testDir;
      runDoctor(makeArgs({ flags: { json: true } }));
      process.cwd = origCwd;
      const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(stdout) as { findings: Array<{ category?: string }> };
      expect(parsed.findings.length).toBeGreaterThan(0);
      expect(stdout).not.toContain('as-agent');
    } finally {
      logSpy.mockRestore();
    }
  });
});
