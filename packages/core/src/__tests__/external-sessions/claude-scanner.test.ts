import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findClaudeSessionFile, listClaudeSessions } from '../../external-sessions/claude-scanner.js';

let root: string;

function writeSession(
  projectSlug: string,
  fileName: string,
  lines: object[],
  mtime?: Date,
): string {
  const projectDir = join(root, projectSlug);
  mkdirSync(projectDir, { recursive: true });
  const filePath = join(projectDir, fileName);
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  if (mtime) {
    utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentmesa-claude-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const MAIN_ID = '11111111-2222-3333-4444-555555555555';

function mainSessionLines(): object[] {
  return [
    { type: 'user', sessionId: MAIN_ID, cwd: 'E:\\AgentMesa', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: '帮我重构界面' } },
    { type: 'ai-title', aiTitle: '旧标题' },
    { type: 'assistant', sessionId: MAIN_ID, timestamp: '2026-08-30T01:00:05.000Z', message: { content: [{ type: 'text', text: '好的' }] } },
    { type: 'ai-title', aiTitle: '登录模块重构' },
  ];
}

describe('listClaudeSessions', () => {
  it('lists jsonl sessions with title/cwd/projectDir/size and no threadSource', () => {
    const now = new Date();
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines(), now);

    const sessions = listClaudeSessions({ rootDir: root });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.source).toBe('claude');
    expect(session.sessionId).toBe(MAIN_ID);
    expect(session.title).toBe('登录模块重构');
    expect(session.cwd).toBe('E:\\AgentMesa');
    expect(session.projectDir).toBe('E--AgentMesa');
    expect(session.sizeBytes).toBeGreaterThan(0);
    expect(session.threadSource).toBeUndefined();
    expect(session.lastModified).toBe(now.toISOString());
  });

  it('uses the last ai-title line (titles are rewritten periodically)', () => {
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines());

    expect(listClaudeSessions({ rootDir: root })[0]!.title).toBe('登录模块重构');
  });

  it('falls back to 未命名会话 <id 前 8 位> when there is no ai-title', () => {
    writeSession('E--Other', 'abcdef12-0000-0000-0000-000000000000.jsonl', [
      { type: 'user', cwd: 'E:\\Other', timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: 'hi' } },
    ]);

    const sessions = listClaudeSessions({ rootDir: root });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe('未命名会话 abcdef12');
  });

  it('ignores nested subagents/ files and non-jsonl entries', () => {
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines());
    mkdirSync(join(root, 'E--AgentMesa', 'subagents'), { recursive: true });
    writeFileSync(join(root, 'E--AgentMesa', 'subagents', 'sub-9999.jsonl'), '{}\n', 'utf8');
    writeFileSync(join(root, 'E--AgentMesa', 'notes.txt'), 'not a session', 'utf8');
    writeFileSync(join(root, 'loose-file.jsonl'), '{}\n', 'utf8');

    const sessions = listClaudeSessions({ rootDir: root });

    expect(sessions.map((session) => session.sessionId)).toEqual([MAIN_ID]);
  });

  it('marks sessions active only when mtime is within 5 minutes', () => {
    const recent = new Date(Date.now() - 60_000);
    const stale = new Date(Date.now() - 10 * 60_000);
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines(), recent);
    writeSession('E--Other', '99999999-0000-0000-0000-000000000000.jsonl', [{ cwd: 'E:\\Other' }], stale);

    const sessions = listClaudeSessions({ rootDir: root });
    const byId = new Map(sessions.map((session) => [session.sessionId, session]));

    expect(byId.get(MAIN_ID)!.active).toBe(true);
    expect(byId.get('99999999-0000-0000-0000-000000000000')!.active).toBe(false);
  });

  it('filters by modifiedSince', () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines(), stale);
    writeSession('E--Other', '88888888-0000-0000-0000-000000000000.jsonl', [{ cwd: 'E:\\Other' }]);

    const sessions = listClaudeSessions({
      rootDir: root,
      modifiedSince: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    expect(sessions.map((session) => session.sessionId)).toEqual(['88888888-0000-0000-0000-000000000000']);
  });

  it('sorts newest first', () => {
    const older = new Date('2026-08-29T00:00:00Z');
    const newer = new Date('2026-08-30T00:00:00Z');
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines(), older);
    writeSession('E--Other', '77777777-0000-0000-0000-000000000000.jsonl', [{ cwd: 'E:\\Other' }], newer);

    const sessions = listClaudeSessions({ rootDir: root });

    expect(sessions.map((session) => session.sessionId)).toEqual([
      '77777777-0000-0000-0000-000000000000',
      MAIN_ID,
    ]);
  });

  it('returns [] for a missing root', () => {
    expect(listClaudeSessions({ rootDir: join(root, 'does-not-exist') })).toEqual([]);
  });
});

describe('findClaudeSessionFile', () => {
  it('finds a session by id and returns an absolute path', () => {
    const filePath = writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines());

    const found = findClaudeSessionFile(MAIN_ID, root);

    expect(found).toBe(filePath);
  });

  it('finds sessions nested under subagents/', () => {
    mkdirSync(join(root, 'E--AgentMesa', 'subagents'), { recursive: true });
    const nested = join(root, 'E--AgentMesa', 'subagents', 'sub-9999.jsonl');
    writeFileSync(nested, '{}\n', 'utf8');

    expect(findClaudeSessionFile('sub-9999', root)).toBe(nested);
  });

  it('returns undefined for unknown ids', () => {
    writeSession('E--AgentMesa', `${MAIN_ID}.jsonl`, mainSessionLines());

    expect(findClaudeSessionFile('missing-id', root)).toBeUndefined();
  });
});
