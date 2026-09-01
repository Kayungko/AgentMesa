import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findCodexSessionFile, listCodexSessions } from '../../external-sessions/codex-scanner.js';

let root: string;

const USER_ID = '01a057b3-0dce-7421-afb6-0e97ae12df2a';
const SUBAGENT_ID = 'aa111111-bb22-cc33-dd44-ee5555555555';

function writeRollout(
  fileName: string,
  meta: object,
  extraLines: object[] = [],
  mtime?: Date,
): string {
  const filePath = join(root, '2026', '08', '31', fileName);
  mkdirSync(join(root, '2026', '08', '31'), { recursive: true });
  const lines = [{ timestamp: '2026-08-31T12:02:27.000Z', type: 'session_meta', payload: meta }, ...extraLines];
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  if (mtime) {
    utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentmesa-codex-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listCodexSessions', () => {
  it('includeSubagents lists non-user threads with their parent thread id', () => {
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );
    writeRollout(
      `rollout-2026-08-31T20-05-00-${SUBAGENT_ID}.jsonl`,
      { id: SUBAGENT_ID, cwd: 'E:\\AgentMesa', thread_source: 'subagent', parent_thread_id: USER_ID },
    );

    // Default: only the user thread.
    expect(listCodexSessions({ rootDir: root }).map((session) => session.sessionId)).toEqual([USER_ID]);

    // Opt-in: the subagent thread is listed and carries the parent anchor.
    const withSubs = listCodexSessions({ rootDir: root, includeSubagents: true });
    expect(withSubs.map((session) => session.sessionId).sort()).toEqual([SUBAGENT_ID, USER_ID].sort());
    const subagent = withSubs.find((session) => session.sessionId === SUBAGENT_ID)!;
    expect(subagent.threadSource).toBe('subagent');
    expect(subagent.parentThreadId).toBe(USER_ID);
    // User threads have no parent anchor.
    expect(withSubs.find((session) => session.sessionId === USER_ID)!.parentThreadId).toBeUndefined();
  });

  it('lists user threads with sessionId/cwd/title from the first session_meta line', () => {
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user', originator: 'Codex Desktop' },
    );

    const sessions = listCodexSessions({ rootDir: root });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.source).toBe('codex');
    expect(session.sessionId).toBe(USER_ID);
    expect(session.cwd).toBe('E:\\AgentMesa');
    expect(session.title).toBe('codex 08-31 20:02 AgentMesa');
    expect(session.threadSource).toBe('user');
    expect(session.sizeBytes).toBeGreaterThan(0);
    expect(session.projectDir).toBeUndefined();
  });

  it('excludes subagent and guardian_review threads (child-thread files are not resumable sessions)', () => {
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );
    writeRollout(
      `rollout-2026-08-31T21-00-00-${SUBAGENT_ID}.jsonl`,
      { id: SUBAGENT_ID, cwd: 'E:\\AgentMesa', thread_source: 'subagent' },
    );
    writeRollout(
      'rollout-2026-08-31T21-30-00-99999999-8888-7777-6666-555555555555.jsonl',
      { id: '99999999-8888-7777-6666-555555555555', cwd: 'E:\\AgentMesa', thread_source: 'guardian_review' },
    );

    const sessions = listCodexSessions({ rootDir: root });

    expect(sessions.map((session) => session.sessionId)).toEqual([USER_ID]);
  });

  it('ignores files that are not rollout transcripts', () => {
    writeRollout(`rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`, {
      id: USER_ID,
      cwd: 'E:\\AgentMesa',
      thread_source: 'user',
    });
    const other = join(root, '2026', '08', '31', 'notes.jsonl');
    writeFileSync(other, '{}\n', 'utf8');

    expect(listCodexSessions({ rootDir: root })).toHaveLength(1);
  });

  it('skips files whose first line is not a session_meta record', () => {
    const filePath = join(root, '2026', '08', '31', `rollout-2026-08-31T19-00-00-${SUBAGENT_ID}.jsonl`);
    mkdirSync(join(root, '2026', '08', '31'), { recursive: true });
    writeFileSync(filePath, 'garbage not json\n', 'utf8');

    expect(listCodexSessions({ rootDir: root })).toEqual([]);
  });

  it('marks sessions active only when mtime is within 5 minutes', () => {
    const recent = new Date(Date.now() - 60_000);
    const stale = new Date(Date.now() - 10 * 60_000);
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
      [],
      recent,
    );
    writeRollout(
      'rollout-2026-08-31T19-00-00-99999999-8888-7777-6666-555555555555.jsonl',
      { id: '99999999-8888-7777-6666-555555555555', cwd: 'E:\\AgentMesa', thread_source: 'user' },
      [],
      stale,
    );

    const sessions = listCodexSessions({ rootDir: root });
    const byId = new Map(sessions.map((session) => [session.sessionId, session]));

    expect(byId.get(USER_ID)!.active).toBe(true);
    expect(byId.get('99999999-8888-7777-6666-555555555555')!.active).toBe(false);
  });

  it('filters by modifiedSince', () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
      [],
      stale,
    );
    writeRollout(
      'rollout-2026-08-31T19-00-00-99999999-8888-7777-6666-555555555555.jsonl',
      { id: '99999999-8888-7777-6666-555555555555', cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );

    const sessions = listCodexSessions({
      rootDir: root,
      modifiedSince: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    expect(sessions.map((session) => session.sessionId)).toEqual(['99999999-8888-7777-6666-555555555555']);
  });

  it('returns [] for a missing root', () => {
    expect(listCodexSessions({ rootDir: join(root, 'does-not-exist') })).toEqual([]);
  });
});

describe('findCodexSessionFile', () => {
  it('finds a session by the UUID in the filename', () => {
    const filePath = writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );

    expect(findCodexSessionFile(USER_ID, root)).toBe(filePath);
  });

  it('matches by first-line payload.id even when the filename lacks the id', () => {
    const filePath = writeRollout(
      'rollout-2026-08-31T20-02-27-no-uuid-here.jsonl',
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );

    expect(findCodexSessionFile(USER_ID, root)).toBe(filePath);
  });

  it('finds subagent files too (listing excludes them, lookup does not)', () => {
    const filePath = writeRollout(
      `rollout-2026-08-31T21-00-00-${SUBAGENT_ID}.jsonl`,
      { id: SUBAGENT_ID, cwd: 'E:\\AgentMesa', thread_source: 'subagent' },
    );

    expect(findCodexSessionFile(SUBAGENT_ID, root)).toBe(filePath);
  });

  it('returns undefined for unknown ids', () => {
    writeRollout(
      `rollout-2026-08-31T20-02-27-${USER_ID}.jsonl`,
      { id: USER_ID, cwd: 'E:\\AgentMesa', thread_source: 'user' },
    );

    expect(findCodexSessionFile('ffffffff-0000-0000-0000-000000000000', root)).toBeUndefined();
  });
});
