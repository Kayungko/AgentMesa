#!/usr/bin/env node
/**
 * Scripted mock of `codex app-server` for driver unit tests.
 *
 * Speaks the verified app-server wire protocol: newline-delimited JSON-RPC
 * 2.0 WITHOUT the "jsonrpc" field. Behavior is selected via env:
 *
 *   MOCK_CODEX_SCENARIO = happy | approval-command | approval-patch |
 *                         interruptible | crash
 *   MOCK_CODEX_LOG      = path to a JSONL file recording every received
 *                         request/notification and every approval decision.
 *
 * Log entry shapes:
 *   { dir: "recv", method, params? }   — client -> server traffic
 *   { dir: "decision", id, result }    — client's answer to a server request
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SCENARIO = process.env.MOCK_CODEX_SCENARIO ?? 'happy';
const LOG_PATH = process.env.MOCK_CODEX_LOG;

function log(entry) {
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging is best-effort.
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  write({ id, result });
}

function notify(method, params) {
  write({ method, params });
}

let nextServerRequestId = 9001;
/** Server request id -> settle callback for pending approval waits. */
const pendingApprovals = new Map();

function serverRequest(method, params) {
  const id = nextServerRequestId++;
  write({ method, id, params });
  return new Promise((resolve) => {
    pendingApprovals.set(id, resolve);
  });
}

const THREAD_ID = 'thr_mock_1';
const TURN_ID = 'turn_mock_1';
let activeThreadId = THREAD_ID;
let interrupted = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function happyStream() {
  await sleep(5);
  notify('item/started', {
    item: { id: 'it_r', type: 'reasoning', summary: '', content: '' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('item/reasoning/summaryTextDelta', {
    threadId: activeThreadId,
    turnId: TURN_ID,
    itemId: 'it_r',
    delta: 'Thinking hard about the task',
    summaryIndex: 0,
  });
  notify('item/started', {
    item: { id: 'it_m', type: 'agentMessage', text: '' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'it_m', delta: 'Hello ' });
  notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'it_m', delta: 'world' });
  notify('item/started', {
    item: { id: 'it_c', type: 'commandExecution', command: 'npm test', cwd: '/w', status: 'inProgress' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('item/completed', {
    item: { id: 'it_c', type: 'commandExecution', command: 'npm test', cwd: '/w', status: 'completed', exitCode: 0 },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('item/completed', {
    item: { id: 'it_m', type: 'agentMessage', text: 'Hello world' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('turn/completed', {
    threadId: activeThreadId,
    turn: {
      id: TURN_ID,
      status: 'completed',
      items: [{ id: 'it_m', type: 'agentMessage', text: 'Hello world' }],
      error: null,
    },
  });
}

async function approvalCommandStream() {
  await sleep(5);
  notify('item/started', {
    item: { id: 'it_cmd', type: 'commandExecution', command: 'rm -rf build', cwd: '/w', status: 'inProgress' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  await serverRequest('item/commandExecution/requestApproval', {
    kind: 'command',
    threadId: activeThreadId,
    turnId: TURN_ID,
    itemId: 'it_cmd',
    command: 'rm -rf build',
    cwd: '/w',
    reason: 'untrusted command',
  });
  notify('item/completed', {
    item: { id: 'it_cmd', type: 'commandExecution', command: 'rm -rf build', cwd: '/w', status: 'completed', exitCode: 0 },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('turn/completed', {
    threadId: activeThreadId,
    turn: { id: TURN_ID, status: 'completed', items: [], error: null },
  });
}

async function approvalPatchStream() {
  await sleep(5);
  notify('item/started', {
    item: {
      id: 'it_f',
      type: 'fileChange',
      changes: [{ path: 'a.txt', kind: 'add', diff: '+hello' }],
      status: 'inProgress',
    },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  await serverRequest('item/fileChange/requestApproval', {
    threadId: activeThreadId,
    turnId: TURN_ID,
    itemId: 'it_f',
    reason: 'apply patch',
  });
  notify('item/completed', {
    item: { id: 'it_f', type: 'fileChange', status: 'completed', changes: [{ path: 'a.txt', kind: 'add' }] },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('turn/completed', {
    threadId: activeThreadId,
    turn: { id: TURN_ID, status: 'completed', items: [], error: null },
  });
}

async function interruptibleStream() {
  await sleep(5);
  notify('item/started', {
    item: { id: 'it_m', type: 'agentMessage', text: '' },
    threadId: activeThreadId,
    turnId: TURN_ID,
  });
  notify('item/agentMessage/delta', {
    threadId: activeThreadId,
    turnId: TURN_ID,
    itemId: 'it_m',
    delta: 'partial answer',
  });
  // Intentionally never completes: the test drives turn/interrupt, and the
  // turn/interrupt handler below emits turn/completed(interrupted).
}

async function crashStream() {
  await sleep(5);
  process.exit(1);
}

const STREAMS = {
  happy: happyStream,
  'approval-command': approvalCommandStream,
  'approval-patch': approvalPatchStream,
  interruptible: interruptibleStream,
  crash: crashStream,
};

function handleRequest(msg) {
  const { method, id, params } = msg;
  log({ dir: 'recv', method, params });
  switch (method) {
    case 'initialize':
      reply(id, {
        userAgent: 'mock-codex/0.1.0',
        codexHome: '/mock/.codex',
        platformFamily: 'mock',
        platformOs: process.platform,
      });
      return;
    case 'thread/start':
      reply(id, { thread: { id: THREAD_ID, preview: '', createdAt: 0 } });
      notify('thread/started', { thread: { id: THREAD_ID, preview: '', createdAt: 0 } });
      return;
    case 'thread/resume':
      reply(id, { thread: { id: params?.threadId ?? THREAD_ID, turns: [] } });
      return;
    case 'turn/start': {
      activeThreadId = params?.threadId ?? THREAD_ID;
      reply(id, { turn: { id: TURN_ID, status: 'inProgress', items: [], error: null } });
      notify('turn/started', {
        threadId: activeThreadId,
        turn: { id: TURN_ID, status: 'inProgress', items: [], error: null },
      });
      const stream = STREAMS[SCENARIO];
      if (stream) void stream();
      return;
    }
    case 'turn/interrupt':
      reply(id, {});
      if (SCENARIO === 'interruptible' && !interrupted) {
        interrupted = true;
        notify('turn/completed', {
          threadId: activeThreadId,
          turn: { id: TURN_ID, status: 'interrupted', items: [], error: null },
        });
      }
      return;
    default:
      write({ id, error: { code: -32601, message: `mock: unknown method ${method}` } });
  }
}

function handleResponse(msg) {
  const { id, result } = msg;
  log({ dir: 'decision', id, result });
  const settle = pendingApprovals.get(id);
  if (settle) {
    pendingApprovals.delete(id);
    settle(result);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (typeof msg !== 'object' || msg === null) return;
  if (msg.method !== undefined) {
    if (msg.id === undefined) {
      // Client notification (e.g. `initialized`) — nothing to do.
      log({ dir: 'recv', method: msg.method, params: msg.params });
      return;
    }
    handleRequest(msg);
    return;
  }
  if (msg.id !== undefined) {
    handleResponse(msg);
  }
});

// Keep stdin errors (EPIPE on close) from crashing the mock with noise.
process.stdin.on('error', () => {});
