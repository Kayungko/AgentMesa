import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCodexSession } from '../../external-sessions/codex-parser.js';

let dir: string;
let filePath: string;

const SESSION_ID = '01a057b3-0dce-7421-afb6-0e97ae12df2a';

function writeLines(lines: object[], fileName = `rollout-2026-08-31T20-02-27-${SESSION_ID}.jsonl`): string {
  filePath = join(dir, fileName);
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return filePath;
}

function baseSession(): object[] {
  return [
    { timestamp: '2026-08-31T12:02:27.000Z', type: 'session_meta', payload: { id: SESSION_ID, cwd: 'E:\\AgentMesa', thread_source: 'user', originator: 'Codex Desktop' } },
    { timestamp: '2026-08-31T12:02:28.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    { timestamp: '2026-08-31T12:02:29.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '继续开发' }] } },
    { timestamp: '2026-08-31T12:02:30.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已完成' }] } },
    { timestamp: '2026-08-31T12:02:31.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'git status', call_id: 'c1' } },
    { timestamp: '2026-08-31T12:02:32.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'nothing to commit' } },
    { timestamp: '2026-08-31T12:02:33.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'eyJzZWNyZXQ' } },
    { timestamp: '2026-08-31T12:02:34.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } },
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentmesa-codex-parse-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseCodexSession', () => {
  it('normalizes the timeline in file order with correct kinds and speakers', () => {
    writeLines(baseSession());

    const messages = parseCodexSession(filePath).messages;

    expect(messages.map((message) => message.kind)).toEqual([
      'turn_boundary',
      'text',
      'text',
      'tool_use',
      'tool_result',
      'encrypted',
      'turn_boundary',
    ]);
    expect(messages[0]).toMatchObject({ summary: 'turn 开始', createdAt: '2026-08-31T12:02:28.000Z' });
    expect(messages[1]).toMatchObject({ speaker: 'user:imported-codex', summary: '继续开发', body: '继续开发' });
    expect(messages[2]).toMatchObject({ speaker: 'agent:codex-external', summary: '已完成', body: '已完成' });
    expect(messages[3]).toMatchObject({ toolName: 'exec' });
    expect(messages[3]!.summary).toContain('exec(');
    expect(messages[4]).toMatchObject({ kind: 'tool_result', speaker: 'agent:codex-external', body: 'nothing to commit', toolName: 'exec' });
    expect(messages[6]).toMatchObject({ summary: 'turn 完成' });
  });

  it('filters environment-injected user input (# AGENTS.md / <permissions)', () => {
    writeLines([
      ...baseSession().slice(0, 3),
      { timestamp: '2026-08-31T12:03:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for this repo' }] } },
      { timestamp: '2026-08-31T12:03:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<permissions allowlist injected by host>' }] } },
      { timestamp: '2026-08-31T12:03:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '真实用户输入' }] } },
    ]);

    const userTexts = parseCodexSession(filePath).messages
      .filter((message) => message.speaker === 'user:imported-codex');

    expect(userTexts.map((message) => message.body)).toEqual(['继续开发', '真实用户输入']);
  });

  it('replaces reasoning/compaction/agent_message with encrypted placeholders without leaking ciphertext', () => {
    writeLines([
      ...baseSession().slice(0, 2),
      { timestamp: '2026-08-31T12:03:00.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'eyJjaXBoZXJ0ZXh0' } },
      { timestamp: '2026-08-31T12:03:01.000Z', type: 'response_item', payload: { type: 'compaction', encrypted_content: 'eyJjb21wYWN0ZWQ' } },
      { timestamp: '2026-08-31T12:03:02.000Z', type: 'response_item', payload: { type: 'agent_message', encrypted_content: 'eyJhZ2VudA' } },
    ]);

    const messages = parseCodexSession(filePath).messages;
    const encrypted = messages.filter((message) => message.kind === 'encrypted');

    expect(encrypted).toHaveLength(3);
    expect(encrypted.every((message) => message.summary === '加密推理（不可读）')).toBe(true);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain('eyJjaXBoZXJ0ZXh0');
    expect(serialized).not.toContain('eyJjb21wYWN0ZWQ');
  });

  it('skips developer messages, turn_context, world_state and compacted top-level records', () => {
    writeLines([
      ...baseSession().slice(0, 2),
      { timestamp: '2026-08-31T12:03:00.000Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system-ish' }] } },
      { timestamp: '2026-08-31T12:03:01.000Z', type: 'turn_context', payload: { cwd: 'E:\\AgentMesa', model: 'gpt-5' } },
      { timestamp: '2026-08-31T12:03:02.000Z', type: 'world_state', payload: {} },
      { timestamp: '2026-08-31T12:03:03.000Z', type: 'compacted', payload: {} },
      { timestamp: '2026-08-31T12:03:04.000Z', type: 'inter_agent_communication_metadata', payload: {} },
      { timestamp: '2026-08-31T12:03:05.000Z', type: 'event_msg', payload: { type: 'item_completed', item_id: 'x' } },
    ]);

    expect(parseCodexSession(filePath).messages).toHaveLength(1); // only task_started
  });

  it('handles function_call / function_call_output pairs', () => {
    writeLines([
      ...baseSession().slice(0, 3),
      { timestamp: '2026-08-31T12:03:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}', call_id: 'f1' } },
      { timestamp: '2026-08-31T12:03:01.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'f1', output: 'file1\nfile2' } },
    ]);

    const messages = parseCodexSession(filePath).messages;

    expect(messages[2]).toMatchObject({ kind: 'tool_use', toolName: 'shell', body: '{"cmd":"ls"}' });
    expect(messages[3]).toMatchObject({ kind: 'tool_result', toolName: 'shell', body: 'file1\nfile2' });
  });

  it('fills summary title/cwd/threadSource/startedAt from the session_meta line', () => {
    writeLines(baseSession());

    const parsed = parseCodexSession(filePath);

    expect(parsed.summary).toMatchObject({
      source: 'codex',
      sessionId: SESSION_ID,
      cwd: 'E:\\AgentMesa',
      threadSource: 'user',
      title: 'codex 08-31 20:02 AgentMesa',
    });
    expect(parsed.startedAt).toBe('2026-08-31T12:02:27.000Z');
    expect(parsed.summary.sizeBytes).toBeGreaterThan(0);
    expect(parsed.filePath).toBe(filePath);
  });

  it('falls back to the filename UUID when session_meta has no id', () => {
    writeLines(
      [
        { timestamp: '2026-08-31T12:02:27.000Z', type: 'session_meta', payload: { cwd: 'E:\\AgentMesa', thread_source: 'subagent' } },
        { timestamp: '2026-08-31T12:02:29.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
      ],
      `rollout-2026-08-31T21-00-00-${SESSION_ID}.jsonl`,
    );

    const parsed = parseCodexSession(filePath);

    expect(parsed.summary.sessionId).toBe(SESSION_ID);
    expect(parsed.summary.threadSource).toBe('subagent');
    expect(parsed.messages).toHaveLength(1);
  });

  it('truncates bodies to maxBodyLength (default 8000, overridable)', () => {
    const longOutput = 'y'.repeat(20_000);
    writeLines([
      ...baseSession().slice(0, 2),
      { timestamp: '2026-08-31T12:03:00.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: longOutput } },
    ]);

    const defaultParsed = parseCodexSession(filePath);
    const capped = parseCodexSession(filePath, { maxBodyLength: 50 });

    expect(defaultParsed.messages[1]!.body!.length).toBe(8_000);
    expect(capped.messages[1]!.body!.length).toBe(50);
  });

  it('survives blank and malformed lines', () => {
    filePath = join(dir, `rollout-2026-08-31T20-02-27-${SESSION_ID}.jsonl`);
    writeFileSync(
      filePath,
      [
        '',
        '{broken json',
        JSON.stringify({ timestamp: '2026-08-31T12:02:27.000Z', type: 'session_meta', payload: { id: SESSION_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' } }),
        JSON.stringify({ timestamp: '2026-08-31T12:02:29.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] } }),
        '',
      ].join('\n') + '\n',
      'utf8',
    );

    const parsed = parseCodexSession(filePath);

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.startedAt).toBe('2026-08-31T12:02:27.000Z');
  });
});
