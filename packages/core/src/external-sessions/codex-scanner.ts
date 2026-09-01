/**
 * Codex rollout session scanner.
 *
 * Layout: `<root>/YYYY/MM/DD/rollout-<local-ts>-<uuid>.jsonl` where root
 * defaults to `~/.codex/sessions`. Only the FIRST line of each file is read
 * (`session_meta` record) — single files can reach ~12.8MB, so the scan never
 * reads past the first newline.
 */

import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { ExternalSessionScanOptions, ExternalSessionSummary } from './types.js';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
/** First-line read buffer; session_meta lines are far smaller than this. */
const FIRST_LINE_BUFFER = 64 * 1024;

interface CodexSessionMeta {
  id?: unknown;
  cwd?: unknown;
  thread_source?: unknown;
  /** Present on subagent threads: the spawning (parent) thread id. */
  parent_thread_id?: unknown;
}

export function defaultCodexSessionsRoot(): string {
  return join(homedir(), '.codex', 'sessions');
}

/** Read only the first line (up to the first `\n`) of a file. */
function readFirstLine(filePath: string): string {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(FIRST_LINE_BUFFER);
    const bytes = readSync(fd, buffer, 0, FIRST_LINE_BUFFER, 0);
    const text = buffer.toString('utf8', 0, bytes);
    const newlineIndex = text.indexOf('\n');
    return newlineIndex === -1 ? text : text.slice(0, newlineIndex);
  } finally {
    closeSync(fd);
  }
}

/** Parse the `session_meta` first line; returns undefined when unreadable. */
function readSessionMeta(filePath: string): CodexSessionMeta | undefined {
  const firstLine = readFirstLine(filePath);
  try {
    const obj = JSON.parse(firstLine) as { type?: unknown; payload?: CodexSessionMeta };
    if (obj?.type === 'session_meta' && obj.payload && typeof obj.payload === 'object') {
      return obj.payload;
    }
  } catch {
    // truncated / non-JSON first line — treat as no metadata
  }
  return undefined;
}

/** Collect `rollout-*.jsonl` files by walking the YYYY/MM/DD tree. */
function collectRolloutFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

/** `E:\AgentMesa` -> `AgentMesa` */
function cwdTail(cwd: string | undefined): string {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return 'unknown';
  }
  const segments = cwd.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? (segments[segments.length - 1] as string) : 'unknown';
}

/** Extract `MM-DD HH:mm` from `rollout-2026-08-31T20-02-27-<uuid>.jsonl`. */
function localTimeFromFilename(fileName: string): string {
  const match = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(fileName);
  if (!match) {
    return '';
  }
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  return `${month}-${day} ${hour}:${minute}`;
}

/** Synthesized title: `codex 08-31 20:02 AgentMesa`. */
export function buildCodexTitle(filePath: string, cwd: string | undefined): string {
  const fileName = basename(filePath);
  const time = localTimeFromFilename(fileName);
  return `codex ${time} ${cwdTail(cwd)}`.trim();
}

/** List Codex sessions, newest first. Only `thread_source === 'user'` sessions are listed unless `includeSubagents` is set. */
export function listCodexSessions(options?: ExternalSessionScanOptions): ExternalSessionSummary[] {
  const root = resolve(options?.rootDir ?? defaultCodexSessionsRoot());
  const modifiedSinceMs = options?.modifiedSince !== undefined
    ? new Date(options.modifiedSince).getTime()
    : undefined;

  const results: ExternalSessionSummary[] = [];
  for (const filePath of collectRolloutFiles(root)) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (modifiedSinceMs !== undefined && stat.mtimeMs <= modifiedSinceMs) {
      continue;
    }
    const meta = readSessionMeta(filePath);
    if (!meta) {
      continue;
    }
    // NOTE: only user threads are listed by default. Subagent /
    // guardian_review rollout files are named by the CHILD thread id (not the
    // resumable parent session id), so they are import-visible only when the
    // caller explicitly opts in (`includeSubagents`) — adoption/resume still
    // target the parent. The parsers can always read them when addressed
    // directly.
    if (meta.thread_source !== 'user' && options?.includeSubagents !== true) {
      continue;
    }
    if (typeof meta.id !== 'string' || meta.id.length === 0) {
      continue;
    }
    const cwd = typeof meta.cwd === 'string' ? meta.cwd : undefined;
    results.push({
      source: 'codex',
      sessionId: meta.id,
      title: buildCodexTitle(filePath, cwd),
      cwd,
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
      threadSource: typeof meta.thread_source === 'string' ? meta.thread_source : undefined,
      ...(typeof meta.parent_thread_id === 'string' && meta.parent_thread_id.length > 0
        ? { parentThreadId: meta.parent_thread_id }
        : {}),
    });
  }

  results.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
  return results;
}

/**
 * Locate the rollout file for a Codex session id: matches the UUID embedded in
 * the filename OR the `session_meta.payload.id` on the first line. Returns an
 * absolute path, or undefined when not found.
 */
export function findCodexSessionFile(sessionId: string, rootDir?: string): string | undefined {
  const root = resolve(rootDir ?? defaultCodexSessionsRoot());
  for (const filePath of collectRolloutFiles(root)) {
    if (basename(filePath).includes(sessionId)) {
      return filePath;
    }
    const meta = readSessionMeta(filePath);
    if (meta && meta.id === sessionId) {
      return filePath;
    }
  }
  return undefined;
}
