import { describe, it, expect } from 'vitest';
import {
  ClaudeSdkDriver,
  type SdkMessageLike,
  type SdkPermissionResultLike,
  type SdkQueryFn,
  type SdkQueryOptionsLike,
} from '../claude-sdk-driver.js';
import type { AgentDriverSession, DriverEvent } from '../types.js';

const CWD = 'E:/AgentMesa/.tmpfiles/fake-workspace';

/** Collect all events of one turn into an array. */
async function collectTurn(
  session: AgentDriverSession,
  input: { prompt: string; timeoutMs?: number },
  onEvent?: (event: DriverEvent) => void | Promise<void>
): Promise<DriverEvent[]> {
  const events: DriverEvent[] = [];
  for await (const event of session.send(input)) {
    events.push(event);
    if (onEvent) await onEvent(event);
  }
  return events;
}

/** A query stream that stalls forever until the abort signal fires. */
function hangUntilAbort(
  onAbortMessage: string
): (options: SdkQueryOptionsLike) => Promise<never> {
  return (options) =>
    new Promise<never>((_, reject) => {
      options.abortController!.signal.addEventListener('abort', () => {
        reject(new Error(onAbortMessage));
      });
    });
}

describe('ClaudeSdkDriver — event mapping', () => {
  it('maps init/assistant/result messages to text, thinking, tool_use and turn_complete', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      expect(params.prompt).toBe('do the thing');
      expect(params.options?.cwd).toBe(CWD);
      yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      yield {
        type: 'assistant',
        session_id: 'sess-1',
        message: { content: [{ type: 'thinking', thinking: 'let me think' }, { type: 'text', text: 'Hello' }] },
      };
      yield {
        type: 'assistant',
        session_id: 'sess-1',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
      };
      yield { type: 'user', message: { content: [] } }; // ignored kind
      yield { type: 'result', subtype: 'success', is_error: false, result: 'all done', session_id: 'sess-1' };
    };

    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events = await collectTurn(session, { prompt: 'do the thing' });

    expect(events).toEqual([
      { type: 'thinking', text: 'let me think' },
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', tool: 'Bash', input: { command: 'ls' } },
      { type: 'turn_complete', success: true, summary: 'all done' },
    ]);
    expect(session.backendSessionId).toBe('sess-1');
    expect(session.handle()).toEqual({
      kind: 'claude-agent-sdk',
      backendSessionId: 'sess-1',
      createdAt: expect.any(String) as string,
    });
  });

  it('backendSessionId is a placeholder before the first turn and is captured lazily', async () => {
    const queryFn: SdkQueryFn = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-lazy' };
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });
    expect(session.backendSessionId).toBe('');
    expect(session.handle().backendSessionId).toBe('');
    await collectTurn(session, { prompt: 'hi' });
    expect(session.backendSessionId).toBe('sess-lazy');
  });

  it('passes resume with the captured session id on subsequent turns', async () => {
    const seenResumes: Array<string | undefined> = [];
    const queryFn: SdkQueryFn = async function* (params) {
      seenResumes.push(params.options?.resume);
      yield { type: 'system', subtype: 'init', session_id: 'sess-multi' };
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    await collectTurn(session, { prompt: 'turn 1' });
    await collectTurn(session, { prompt: 'turn 2' });
    await collectTurn(session, { prompt: 'turn 3' });

    expect(seenResumes).toEqual([undefined, 'sess-multi', 'sess-multi']);
  });

  it('maps error results to a failed turn_complete with the error summary', async () => {
    const queryFn: SdkQueryFn = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-err' };
      yield { type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['max turns reached'] };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });
    const events = await collectTurn(session, { prompt: 'go' });
    expect(events).toEqual([
      { type: 'turn_complete', success: false, summary: 'max turns reached' },
    ]);
  });

  it('forwards systemPrompt and permissionMode from init options', async () => {
    const seenOptions: SdkQueryOptionsLike[] = [];
    const queryFn: SdkQueryFn = async function* (params) {
      seenOptions.push(params.options!);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    await collectTurn(await driver.createSession({ cwd: CWD, systemPrompt: 'be helpful' }), { prompt: 'x' });
    await collectTurn(await driver.createSession({ cwd: CWD, requirePermissions: true }), { prompt: 'x' });
    expect(seenOptions[0]?.systemPrompt).toBe('be helpful');
    expect(seenOptions[0]?.permissionMode).toBeUndefined();
    expect(seenOptions[1]?.permissionMode).toBe('default');
  });
});

describe('ClaudeSdkDriver — permission bridge', () => {
  it('surfaces canUseTool as permission_request and returns the allow decision to the SDK', async () => {
    const decisions: Array<SdkPermissionResultLike | null> = [];
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-perm' };
      const decision = await params.options!.canUseTool!('Bash', { command: 'rm -rf build' }, {
        signal: params.options!.abortController!.signal,
        toolUseID: 'tu-1',
      });
      decisions.push(decision);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'after permission' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events = await collectTurn(session, { prompt: 'clean up' }, (event) => {
      if (event.type === 'permission_request') {
        void session.respondPermission(event.request.requestId, 'allow');
      }
    });

    const request = events.find((e) => e.type === 'permission_request');
    expect(request).toMatchObject({
      type: 'permission_request',
      request: {
        kind: 'tool',
        title: expect.stringContaining('Bash') as string,
        detail: { toolName: 'Bash', input: { command: 'rm -rf build' } },
      },
    });
    expect(decisions).toEqual([{ behavior: 'allow' }]);
    expect(events.at(-1)).toEqual({ type: 'turn_complete', success: true, summary: 'after permission' });
  });

  it('deny decisions carry the responder message back to the SDK', async () => {
    const decisions: Array<SdkPermissionResultLike | null> = [];
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-perm-deny' };
      const decision = await params.options!.canUseTool!('Write', { file_path: 'a.txt' }, {
        signal: params.options!.abortController!.signal,
        toolUseID: 'tu-2',
        title: 'Write file a.txt',
      });
      decisions.push(decision);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'denied and moved on' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events = await collectTurn(session, { prompt: 'write' }, async (event) => {
      if (event.type === 'permission_request') {
        await session.respondPermission(event.request.requestId, 'deny', 'not in policy');
      }
    });

    expect(decisions).toEqual([{ behavior: 'deny', message: 'not in policy' }]);
    expect(events.at(-1)).toEqual({ type: 'turn_complete', success: true, summary: 'denied and moved on' });
  });

  it('rejects respondPermission for unknown or already-answered request ids', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-unknown' };
      const decision = await params.options!.canUseTool!('Bash', { command: 'ls' }, {
        signal: params.options!.abortController!.signal,
        toolUseID: 'tu-3',
      });
      decisions.push(decision);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' };
    };
    const decisions: Array<SdkPermissionResultLike | null> = [];

    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    await expect(session.respondPermission('nope', 'allow')).rejects.toThrow(/no pending permission/i);

    await collectTurn(session, { prompt: 'x' }, async (event) => {
      if (event.type === 'permission_request') {
        await session.respondPermission(event.request.requestId, 'allow');
        // second answer for the same id must fail
        await expect(session.respondPermission(event.request.requestId, 'allow')).rejects.toThrow(
          /no pending permission/i
        );
      }
    });
    expect(decisions).toEqual([{ behavior: 'allow' }]);
  });

  it('denies pending permission requests when the turn is aborted (close)', async () => {
    const decisions: Array<SdkPermissionResultLike | null> = [];
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-close-perm' };
      const decision = await params.options!.canUseTool!('Bash', { command: 'sleep 100' }, {
        signal: params.options!.abortController!.signal,
        toolUseID: 'tu-4',
      });
      decisions.push(decision);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'done' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events: DriverEvent[] = [];
    const consuming = (async () => {
      for await (const event of session.send({ prompt: 'x' })) events.push(event);
    })();

    // Wait until the permission request surfaces, then close the session.
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (events.some((e) => e.type === 'permission_request')) {
          clearInterval(poll);
          resolve();
        }
      }, 5);
    });
    await session.close();
    await consuming;

    expect(decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ behavior: 'deny' });
    await expect(session.send({ prompt: 'again' }).next()).rejects.toThrow(/closed/i);
  });
});

describe('ClaudeSdkDriver — interrupt, timeout, close', () => {
  it('interrupt aborts the in-flight turn and ends the iterable with a failed turn_complete', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-int' };
      yield { type: 'assistant', session_id: 'sess-int', message: { content: [{ type: 'text', text: 'partial' }] } };
      await hangUntilAbort('aborted by SDK')(params.options!);
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events = await collectTurn(session, { prompt: 'x' }, async (event) => {
      if (event.type === 'text' && event.text === 'partial') {
        await session.interrupt();
      }
    });

    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: false, summary: 'interrupted by user' });

    // A new turn may start after an interrupted one (session not poisoned).
    const followUpEvents: DriverEvent[] = [];
    const followUp = (async () => {
      for await (const event of session.send({ prompt: 'after interrupt' })) followUpEvents.push(event);
    })();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await session.interrupt();
    await followUp;
    expect(followUpEvents.at(-1)).toMatchObject({ type: 'turn_complete', success: false });
  });

  it('timeoutMs aborts the turn with a timeout summary', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-to' };
      await hangUntilAbort('aborted by SDK')(params.options!);
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events = await collectTurn(session, { prompt: 'slow', timeoutMs: 25 });

    expect(events.at(-1)).toMatchObject({
      type: 'turn_complete',
      success: false,
      summary: expect.stringContaining('timed out') as string,
    });
  });

  it('close aborts an in-flight turn and rejects further sends', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-close' };
      await hangUntilAbort('aborted by SDK')(params.options!);
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const events: DriverEvent[] = [];
    const consuming = (async () => {
      for await (const event of session.send({ prompt: 'x' })) events.push(event);
    })();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await session.close();
    await consuming;

    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: false, summary: 'session closed' });
    const iter = session.send({ prompt: 'y' });
    await expect(iter.next()).rejects.toThrow(/closed/i);
  });

  it('rejects a second concurrent turn while one is in flight', async () => {
    const queryFn: SdkQueryFn = async function* (params) {
      yield { type: 'system', subtype: 'init', session_id: 'sess-conc' };
      await hangUntilAbort('aborted by SDK')(params.options!);
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });

    const first = (async () => {
      const events: DriverEvent[] = [];
      for await (const event of session.send({ prompt: 'first' })) events.push(event);
      return events;
    })();

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(session.send({ prompt: 'second' }).next()).rejects.toThrow(/already in flight/i);
    await session.interrupt();
    await first;
  });

  it('maps an unexpected SDK stream failure to a fatal error event plus failed turn_complete', async () => {
    const queryFn: SdkQueryFn = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-boom' };
      throw new Error('CLI crashed');
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });
    const events = await collectTurn(session, { prompt: 'x' });
    expect(events).toEqual([
      { type: 'error', message: 'CLI crashed', fatal: true },
      { type: 'turn_complete', success: false, summary: 'CLI crashed' },
    ]);
  });
});

describe('ClaudeSdkDriver — resume', () => {
  it('resumeSession passes the handle session id as resume to the backend', async () => {
    const seenResumes: Array<string | undefined> = [];
    const queryFn: SdkQueryFn = async function* (params) {
      seenResumes.push(params.options?.resume);
      yield { type: 'system', subtype: 'init', session_id: 'sess-resumed' };
      yield { type: 'result', subtype: 'success', is_error: false, result: 'resumed ok' };
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.resumeSession(
      { kind: 'claude-agent-sdk', backendSessionId: 'sess-resumed', createdAt: '2026-08-30T00:00:00.000Z' },
      { cwd: CWD }
    );

    expect(session.backendSessionId).toBe('sess-resumed');
    expect(session.handle().backendSessionId).toBe('sess-resumed');

    const events = await collectTurn(session, { prompt: 'continue' });
    await collectTurn(session, { prompt: 'continue again' });
    expect(seenResumes).toEqual(['sess-resumed', 'sess-resumed']); // first turn + a second one
    expect(events.at(-1)).toMatchObject({ type: 'turn_complete', success: true });
  });

  it('rejects resume for a foreign handle kind or an empty session id', async () => {
    const driver = new ClaudeSdkDriver({ queryFn: async function* () {} });
    await expect(
      driver.resumeSession(
        { kind: 'codex-app-server', backendSessionId: 'x', createdAt: '2026-08-30T00:00:00.000Z' },
        { cwd: CWD }
      )
    ).rejects.toThrow(/kind mismatch/i);
    await expect(
      driver.resumeSession({ kind: 'claude-agent-sdk', backendSessionId: '', createdAt: '2026-08-30T00:00:00.000Z' }, { cwd: CWD })
    ).rejects.toThrow(/no backendSessionId/i);
  });
});

describe('ClaudeSdkDriver — isAvailable', () => {
  it('is true when a queryFn is injected', async () => {
    const driver = new ClaudeSdkDriver({ queryFn: async function* () {} });
    await expect(driver.isAvailable()).resolves.toBe(true);
  });

  it('is true when the injected SDK import exposes query', async () => {
    const driver = new ClaudeSdkDriver({
      sdkImport: async () => ({ query: () => undefined }),
    });
    await expect(driver.isAvailable()).resolves.toBe(true);
  });

  it('is false when the SDK import fails (SDK not installed)', async () => {
    const driver = new ClaudeSdkDriver({
      sdkImport: async () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    });
    await expect(driver.isAvailable()).resolves.toBe(false);
  });

  it('is false when the loaded module has no query export', async () => {
    const driver = new ClaudeSdkDriver({ sdkImport: async () => ({}) });
    await expect(driver.isAvailable()).resolves.toBe(false);
  });

  it('driver metadata', () => {
    const driver = new ClaudeSdkDriver({ queryFn: async function* () {} });
    expect(driver.kind).toBe('claude-agent-sdk');
    expect(driver.name).toBe('claude-agent-sdk');
  });
});

describe('ClaudeSdkDriver — message edge cases', () => {
  it('ignores unknown message kinds and malformed content blocks', async () => {
    const messages: SdkMessageLike[] = [
      { type: 'stream_event', event: {} },
      { type: 'assistant', message: { content: [{ type: 'redacted_thinking' }, { type: 'text' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: '' },
    ];
    const queryFn: SdkQueryFn = async function* () {
      for (const message of messages) yield message;
    };
    const driver = new ClaudeSdkDriver({ queryFn });
    const session = await driver.createSession({ cwd: CWD });
    const events = await collectTurn(session, { prompt: 'x' });
    expect(events).toEqual([{ type: 'turn_complete', success: true, summary: '' }]);
  });
});
