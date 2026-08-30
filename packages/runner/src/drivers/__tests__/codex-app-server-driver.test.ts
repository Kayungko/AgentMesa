import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { DriverEvent, DriverSessionHandle } from '../types.js';
import type { SpawnFn } from '../codex-app-server-protocol.js';
import { CodexAppServerDriver } from '../codex-app-server-driver.js';

const MOCK_SERVER = fileURLToPath(new URL('./fixtures/mock-codex-app-server.mjs', import.meta.url));
const TMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '.tmpfiles');

let dir: string;
let logPath: string;
const savedEnv = process.env.AGENTMESA_CODEX_APP_SERVER_CMD;

function readLog(): Array<Record<string, unknown>> {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function makeDriver(
  scenario: string,
  options: { children?: ChildProcess[] } = {}
): CodexAppServerDriver {
  const spawnFn: SpawnFn = (command, args, opts: SpawnOptions) => {
    const child = spawn(command, args, {
      ...opts,
      env: { ...process.env, MOCK_CODEX_SCENARIO: scenario, MOCK_CODEX_LOG: logPath },
    });
    options.children?.push(child);
    return child;
  };
  return new CodexAppServerDriver({ command: `node ${MOCK_SERVER}`, spawnFn });
}

async function collect(iter: AsyncIterableIterator<DriverEvent>): Promise<DriverEvent[]> {
  const events: DriverEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

beforeEach(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  dir = mkdtempSync(join(TMP_ROOT, 'codex-driver-'));
  logPath = join(dir, 'mock-log.jsonl');
  delete process.env.AGENTMESA_CODEX_APP_SERVER_CMD;
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.AGENTMESA_CODEX_APP_SERVER_CMD;
  else process.env.AGENTMESA_CODEX_APP_SERVER_CMD = savedEnv;
  // Windows can briefly hold the temp dir (mock child cwd) after kill.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});

describe('CodexAppServerDriver.isAvailable', () => {
  it('returns false for a missing binary without throwing', async () => {
    const driver = new CodexAppServerDriver({ command: 'agentmesa-no-such-bin-xyz' });
    expect(await driver.isAvailable()).toBe(false);
  });

  it('returns true for an installed binary', async () => {
    const driver = makeDriver('happy');
    expect(await driver.isAvailable()).toBe(true);
  });

  it('falls back to the default command when nothing is configured', async () => {
    const driver = new CodexAppServerDriver({});
    expect((driver as unknown as { name: string }).name).toBe('codex-app-server');
    // `codex` may or may not be installed on this machine; must not throw.
    await driver.isAvailable();
  });
});

describe('CodexAppServerDriver session lifecycle', () => {
  it('handshakes, starts a thread and exposes the conversation id', async () => {
    const driver = makeDriver('happy');
    const session = await driver.createSession({ cwd: dir });

    expect(session.kind).toBe('codex-app-server');
    expect(session.backendSessionId).toBe('thr_mock_1');
    expect(session.handle()).toMatchObject({
      kind: 'codex-app-server',
      backendSessionId: 'thr_mock_1',
    });

    const log = readLog();
    const init = log.find((e) => e['dir'] === 'recv' && e['method'] === 'initialize');
    expect(init).toBeDefined();
    expect((init?.['params'] as { clientInfo?: { name?: string } })?.clientInfo?.name).toBe('agentmesa');
    expect(log.some((e) => e['dir'] === 'recv' && e['method'] === 'initialized')).toBe(true);
    const threadStart = log.find((e) => e['dir'] === 'recv' && e['method'] === 'thread/start');
    expect((threadStart?.['params'] as { cwd?: string })?.cwd).toBe(dir);

    await session.close();
  }, 20000);

  it('requests on-request approval policy when requirePermissions is set', async () => {
    const driver = makeDriver('happy');
    const session = await driver.createSession({ cwd: dir, requirePermissions: true });
    const threadStart = readLog().find((e) => e['dir'] === 'recv' && e['method'] === 'thread/start');
    expect((threadStart?.['params'] as { approvalPolicy?: string })?.approvalPolicy).toBe('on-request');
    await session.close();
  }, 20000);

  it('resumes an existing conversation with thread/resume', async () => {
    const driver = makeDriver('happy');
    const handle: DriverSessionHandle = {
      kind: 'codex-app-server',
      backendSessionId: 'thr_resume_9',
      createdAt: new Date().toISOString(),
    };
    const session = await driver.resumeSession(handle, { cwd: dir });

    expect(session.backendSessionId).toBe('thr_resume_9');
    const resume = readLog().find((e) => e['dir'] === 'recv' && e['method'] === 'thread/resume');
    expect(resume).toBeDefined();
    expect((resume?.['params'] as { threadId?: string; excludeTurns?: boolean })?.threadId).toBe('thr_resume_9');
    expect((resume?.['params'] as { excludeTurns?: boolean })?.excludeTurns).toBe(true);

    // The resumed session is fully usable.
    const events = await collect(session.send({ prompt: 'hello again' }));
    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: true });
    await session.close();
  }, 20000);

  it('refuses to resume a foreign session handle', async () => {
    const driver = makeDriver('happy');
    await expect(
      driver.resumeSession(
        { kind: 'claude-agent-sdk', backendSessionId: 'x', createdAt: new Date().toISOString() },
        { cwd: dir }
      )
    ).rejects.toThrow(/cannot resume/);
  }, 20000);

  it('prepends the system prompt to the first turn only', async () => {
    const driver = makeDriver('happy');
    const session = await driver.createSession({ cwd: dir, systemPrompt: 'MESA PREAMBLE' });
    await collect(session.send({ prompt: 'first' }));
    const first = readLog().find((e) => e['dir'] === 'recv' && e['method'] === 'turn/start');
    const firstText = ((first?.['params'] as { input?: Array<{ text?: string }> })?.input ?? [])[0]?.text;
    expect(firstText).toBe('MESA PREAMBLE\n\nfirst');
    await collect(session.send({ prompt: 'second' }));
    const turns = readLog().filter((e) => e['dir'] === 'recv' && e['method'] === 'turn/start');
    const secondText = ((turns[1]?.['params'] as { input?: Array<{ text?: string }> })?.input ?? [])[0]?.text;
    expect(secondText).toBe('second');
    await session.close();
  }, 20000);
});

describe('CodexAppServerDriver event stream', () => {
  it('maps item notifications to DriverEvents and ends with turn_complete', async () => {
    const driver = makeDriver('happy');
    const session = await driver.createSession({ cwd: dir });
    const events = await collect(session.send({ prompt: 'run the happy path' }));

    expect(events).toEqual([
      { type: 'thinking', text: 'Thinking hard about the task' },
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      {
        type: 'tool_use',
        tool: 'commandExecution',
        input: { command: 'npm test', cwd: '/w', status: 'inProgress' },
      },
      { type: 'turn_complete', success: true, summary: 'Hello world' },
    ]);
    await session.close();
  }, 20000);

  it('emits a permission_request for command approvals and writes allow back', async () => {
    const driver = makeDriver('approval-command');
    const session = await driver.createSession({ cwd: dir });

    const events: DriverEvent[] = [];
    for await (const event of session.send({ prompt: 'clean the build' })) {
      events.push(event);
      if (event.type === 'permission_request') {
        expect(event.request.kind).toBe('command');
        expect(event.request.title).toContain('rm -rf build');
        expect(event.request.requestId).toBe('9001');
        await session.respondPermission(event.request.requestId, 'allow');
      }
    }

    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: true });
    const decision = readLog().find((e) => e['dir'] === 'decision');
    expect(decision).toMatchObject({ id: 9001, result: { decision: 'accept' } });
    await session.close();
  }, 20000);

  it('emits a patch permission_request and writes deny back', async () => {
    const driver = makeDriver('approval-patch');
    const session = await driver.createSession({ cwd: dir });

    const events: DriverEvent[] = [];
    for await (const event of session.send({ prompt: 'apply the patch' })) {
      events.push(event);
      if (event.type === 'permission_request') {
        expect(event.request.kind).toBe('patch');
        await session.respondPermission(event.request.requestId, 'deny');
      }
    }

    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: true });
    const decision = readLog().find((e) => e['dir'] === 'decision');
    expect(decision).toMatchObject({ result: { decision: 'decline' } });
    await session.close();
  }, 20000);

  it('surfaces unknown permission ids as errors', async () => {
    const driver = makeDriver('approval-command');
    const session = await driver.createSession({ cwd: dir });
    // Drive the iterator manually: breaking out of a for-await would call
    // iterator.return() and clear the active turn before the assertion.
    const iterator = session.send({ prompt: 'clean the build' });
    let step = await iterator.next();
    while (!step.done && step.value.type !== 'permission_request') {
      step = await iterator.next();
    }
    expect(step.done).toBe(false);
    await expect(session.respondPermission('no-such-request', 'allow')).rejects.toThrow(/unknown permission/);
    await iterator.return?.();
    await session.close();
  }, 20000);
});

describe('CodexAppServerDriver failure and shutdown paths', () => {
  it('ends the iterator with a fatal error when the process crashes', async () => {
    const driver = makeDriver('crash');
    const session = await driver.createSession({ cwd: dir });

    const events = await collect(session.send({ prompt: 'doomed' }));
    expect(events.some((e) => e.type === 'error' && e.fatal === true)).toBe(true);
    // The iterator terminated (no dangling promise) and never saw turn_complete.
    expect(events.some((e) => e.type === 'turn_complete')).toBe(false);
    await session.close();
  }, 20000);

  it('interrupts an in-flight turn via turn/interrupt', async () => {
    const driver = makeDriver('interruptible');
    const session = await driver.createSession({ cwd: dir });

    const events: DriverEvent[] = [];
    for await (const event of session.send({ prompt: 'long task' })) {
      events.push(event);
      if (event.type === 'text' && event.text === 'partial answer') {
        await session.interrupt();
      }
    }

    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: false, summary: 'turn interrupted' });
    const interrupts = readLog().filter((e) => e['dir'] === 'recv' && e['method'] === 'turn/interrupt');
    expect(interrupts.length).toBe(1);
    await session.close();
  }, 20000);

  it('terminates the child process on close', async () => {
    const children: ChildProcess[] = [];
    const driver = makeDriver('happy', { children });
    const session = await driver.createSession({ cwd: dir });
    expect(children.length).toBe(1);
    expect(children[0]?.pid).toBeGreaterThan(0);

    await session.close();
    await new Promise<void>((resolve) => {
      const child = children[0]!;
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('close', () => resolve());
      setTimeout(resolve, 5000);
    });
    const child = children[0]!;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }, 20000);

  it('ends an in-flight turn when the session is closed', async () => {
    const driver = makeDriver('interruptible');
    const session = await driver.createSession({ cwd: dir });

    let closed: Promise<void> | null = null;
    const collected: DriverEvent[] = [];
    for await (const event of session.send({ prompt: 'long task' })) {
      collected.push(event);
      if (event.type === 'text' && !closed) {
        closed = session.close();
      }
    }
    await closed;
    expect(collected.some((e) => e.type === 'error' && e.fatal === true)).toBe(true);
    expect(collected.some((e) => e.type === 'turn_complete')).toBe(false);
  }, 20000);

  it('rejects concurrent turns on one session', async () => {
    const driver = makeDriver('interruptible');
    const session = await driver.createSession({ cwd: dir });
    const first = session.send({ prompt: 'turn one' });
    const firstIterator = first[Symbol.asyncIterator]();
    await firstIterator.next(); // Enter the turn.
    await expect(collect(session.send({ prompt: 'turn two' }))).rejects.toThrow(/already in progress/);
    await firstIterator.return?.();
    await session.close();
  }, 20000);
});
