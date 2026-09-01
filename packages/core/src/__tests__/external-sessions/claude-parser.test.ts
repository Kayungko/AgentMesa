import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseClaudeSession } from '../../external-sessions/claude-parser.js';

let dir: string;
let filePath: string;

function writeLines(lines: object[]): string {
  filePath = join(dir, 'aaaa1111-2222-3333-4444-555555555555.jsonl');
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return filePath;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentmesa-claude-parse-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseSession(): object[] {
  return [
    { type: 'user', sessionId: 's1', cwd: 'E:\\AgentMesa', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: '帮我重构界面' } },
    { type: 'assistant', sessionId: 's1', timestamp: '2026-08-30T01:00:05.000Z', message: { model: 'glm-5.3', content: [{ type: 'text', text: '好的，先看代码' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: '/x' } }] } },
    { type: 'user', sessionId: 's1', timestamp: '2026-08-30T01:00:10.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }] }, toolUseResult: {} },
  ];
}

describe('parseClaudeSession', () => {
  it('extracts the transcript line uuid as externalLineId', () => {
    writeLines([
      { type: 'user', uuid: 'u-aaa', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: '第一问' } },
      { type: 'assistant', uuid: 'a-bbb', timestamp: '2026-08-30T01:00:05.000Z', message: { content: [{ type: 'text', text: '第一答' }] } },
    ]);

    const messages = parseClaudeSession(filePath).messages;

    expect(messages[0]!.externalLineId).toBe('u-aaa');
    expect(messages[1]!.externalLineId).toBe('a-bbb');
    // Lines without a uuid carry no anchor (optional by design).
    writeLines([
      { type: 'user', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: '无 uuid 行' } },
    ]);
    expect(parseClaudeSession(filePath).messages[0]!.externalLineId).toBeUndefined();
  });

  it('normalizes user text / assistant text+tool_use / tool_result in file order', () => {
    writeLines(baseSession());

    const parsed = parseClaudeSession(filePath);
    const messages = parsed.messages;

    expect(messages.map((message) => message.kind)).toEqual(['text', 'text', 'tool_use', 'tool_result']);
    expect(messages[0]).toMatchObject({
      kind: 'text',
      speaker: 'user:imported-claude',
      summary: '帮我重构界面',
      body: '帮我重构界面',
      createdAt: '2026-08-30T01:00:00.000Z',
    });
    expect(messages[1]).toMatchObject({
      kind: 'text',
      speaker: 'agent:claude-external',
      summary: '好的，先看代码',
    });
    expect(messages[2]).toMatchObject({
      kind: 'tool_use',
      speaker: 'agent:claude-external',
      toolName: 'Read',
    });
    expect(messages[2]!.summary).toContain('Read(');
    expect(messages[3]).toMatchObject({
      kind: 'tool_result',
      speaker: 'agent:claude-external',
      summary: '工具结果',
      body: 'file body',
      toolName: 'Read',
    });
  });

  it('drops host-injected user payloads (<task-notification> / <recovered_conversation_context>)', () => {
    writeLines([
      ...baseSession(),
      { type: 'user', timestamp: '2026-08-30T02:00:00.000Z', message: { role: 'user', content: '<task-notification>xxx</task-notification>' } },
      { type: 'user', timestamp: '2026-08-30T02:00:01.000Z', message: { role: 'user', content: '<recovered_conversation_context>recovered</recovered_conversation_context>' } },
      { type: 'user', timestamp: '2026-08-30T02:00:02.000Z', message: { role: 'user', content: '真实追问' } },
    ]);

    const messages = parseClaudeSession(filePath).messages;
    const userTexts = messages.filter((message) => message.speaker === 'user:imported-claude');

    expect(userTexts.map((message) => message.body)).toEqual(['帮我重构界面', '真实追问']);
  });

  it('extracts the title from the last ai-title line and skips attachment/last-prompt', () => {
    writeLines([
      { type: 'ai-title', aiTitle: '旧标题' },
      ...baseSession(),
      { type: 'attachment', attachment: { path: '/tmp/a.png' } },
      { type: 'last-prompt', prompt: '帮我重构界面' },
      { type: 'ai-title', aiTitle: '登录模块重构' },
    ]);

    const parsed = parseClaudeSession(filePath);

    expect(parsed.summary.title).toBe('登录模块重构');
    // 4 messages: exactly the user/assistant records from baseSession.
    expect(parsed.messages).toHaveLength(4);
  });

  it('falls back to 未命名会话 <id 前 8 位> without ai-title', () => {
    writeLines(baseSession());

    expect(parseClaudeSession(filePath).summary.title).toBe('未命名会话 aaaa1111');
  });

  it('maps thinking blocks to the thinking kind on the agent speaker', () => {
    writeLines([
      ...baseSession(),
      {
        type: 'assistant',
        timestamp: '2026-08-30T01:00:20.000Z',
        message: { content: [{ type: 'thinking', thinking: '先分析依赖' }, { type: 'text', text: '结论' }] },
      },
    ]);

    const messages = parseClaudeSession(filePath).messages;
    const thinking = messages.find((message) => message.kind === 'thinking');

    expect(thinking).toMatchObject({
      speaker: 'agent:claude-external',
      summary: '先分析依赖',
      body: '先分析依赖',
    });
  });

  it('truncates bodies to maxBodyLength (default 8000, overridable)', () => {
    const longText = 'x'.repeat(20_000);
    writeLines([
      { type: 'user', timestamp: '2026-08-30T01:00:00.000Z', cwd: 'E:\\AgentMesa', message: { role: 'user', content: longText } },
    ]);

    const defaultParsed = parseClaudeSession(filePath);
    expect(defaultParsed.messages[0]!.body!.length).toBe(8_000);

    const capped = parseClaudeSession(filePath, { maxBodyLength: 100 });
    expect(capped.messages[0]!.body!.length).toBe(100);
  });

  it('falls back to the session start timestamp when a line has none', () => {
    writeLines([
      { type: 'user', cwd: 'E:\\AgentMesa', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: 'first' } },
      { type: 'user', message: { role: 'user', content: 'no timestamp' } },
    ]);

    const parsed = parseClaudeSession(filePath);

    expect(parsed.startedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(parsed.messages[1]!.createdAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('fills the summary with cwd/projectDir/size/filePath and no threadSource', () => {
    const written = writeLines(baseSession());

    const parsed = parseClaudeSession(written);

    expect(parsed.summary).toMatchObject({
      source: 'claude',
      sessionId: 'aaaa1111-2222-3333-4444-555555555555',
      cwd: 'E:\\AgentMesa',
      projectDir: basename(dir),
      threadSource: undefined,
    });
    expect(parsed.summary.sizeBytes).toBeGreaterThan(0);
    expect(parsed.summary.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.filePath).toBe(written);
  });

  it('survives blank and malformed lines', () => {
    filePath = join(dir, 'aaaa1111-2222-3333-4444-555555555555.jsonl');
    writeFileSync(
      filePath,
      [
        '',
        '{not json',
        JSON.stringify({ type: 'user', timestamp: '2026-08-30T01:00:00.000Z', cwd: 'E:\\AgentMesa', message: { role: 'user', content: 'ok' } }),
        '',
      ].join('\n') + '\n',
      'utf8',
    );

    const parsed = parseClaudeSession(filePath);

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.startedAt).toBe('2026-08-30T01:00:00.000Z');
  });
});
