/**
 * Claude Code / Mana transcript scanner.
 *
 * Layout: `<root>/<project-slug>/<sessionId>.jsonl` where root defaults to
 * `~/.claude/projects`. Each first-level directory is a project slug; each
 * direct `.jsonl` child is one session. Files under nested directories
 * (e.g. `subagents/`) are not listed.
 *
 * Listing is cheap: file stat plus one chunked line-oriented pass that only
 * extracts the first line's `cwd` and the last `ai-title` line. Files are
 * never fully loaded into memory (single session files can reach ~13MB).
 */

import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ExternalSessionScanOptions, ExternalSessionSummary } from './types.js';

/** A session counts as active when its file was touched within this window. */
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
/** Chunk size for the streaming meta scan. */
const CHUNK_SIZE = 64 * 1024;

/** Metadata extracted from a Claude session file without loading it fully. */
interface ClaudeFileMeta {
  cwd?: string;
  lastAiTitle?: string;
}

export function defaultClaudeSessionsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Stream the file line by line (chunked `readSync`) collecting only the first
 * line's `cwd` and the last `ai-title` line. `ai-title` lines are rewritten
 * periodically, so the last one wins.
 */
function scanClaudeFileMeta(filePath: string): ClaudeFileMeta {
  const meta: ClaudeFileMeta = {};
  const fd = openSync(filePath, 'r');
  try {
    const chunk = Buffer.alloc(CHUNK_SIZE);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let firstLine = true;
    const consume = (line: string): void => {
      if (line.length === 0) {
        return;
      }
      if (firstLine) {
        firstLine = false;
        try {
          const obj = JSON.parse(line) as { cwd?: unknown };
          if (typeof obj.cwd === 'string') {
            meta.cwd = obj.cwd;
          }
        } catch {
          // first line not JSON — nothing to extract
        }
      }
      // Cheap pre-filter before JSON.parse: ai-title lines are rare.
      if (line.includes('"ai-title"')) {
        try {
          const obj = JSON.parse(line) as { type?: unknown; aiTitle?: unknown };
          if (obj.type === 'ai-title' && typeof obj.aiTitle === 'string') {
            meta.lastAiTitle = obj.aiTitle;
          }
        } catch {
          // partial write — ignore
        }
      }
    };
    for (;;) {
      const bytes = readSync(fd, chunk, 0, CHUNK_SIZE, null);
      if (bytes <= 0) {
        break;
      }
      pending += decoder.write(chunk.subarray(0, bytes));
      for (;;) {
        const idx = pending.indexOf('\n');
        if (idx === -1) {
          break;
        }
        consume(pending.slice(0, idx));
        pending = pending.slice(idx + 1);
      }
    }
    pending += decoder.end();
    if (pending.length > 0) {
      consume(pending);
    }
  } finally {
    closeSync(fd);
  }
  return meta;
}

/** List Claude sessions under the configured root, newest first. */
export function listClaudeSessions(options?: ExternalSessionScanOptions): ExternalSessionSummary[] {
  const root = resolve(options?.rootDir ?? defaultClaudeSessionsRoot());
  const modifiedSinceMs = options?.modifiedSince !== undefined
    ? new Date(options.modifiedSince).getTime()
    : undefined;

  const results: ExternalSessionSummary[] = [];
  let projects;
  try {
    projects = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const project of projects) {
    if (!project.isDirectory()) {
      continue;
    }
    const projectDir = join(root, project.name);
    let entries;
    try {
      entries = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Only direct .jsonl files are sessions; nested directories such as
      // `subagents/` (and anything inside them) are excluded from listing.
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      const filePath = join(projectDir, entry.name);
      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }
      if (modifiedSinceMs !== undefined && stat.mtimeMs <= modifiedSinceMs) {
        continue;
      }
      const sessionId = entry.name.slice(0, -'.jsonl'.length);
      if (sessionId.length === 0) {
        continue;
      }
      const meta = scanClaudeFileMeta(filePath);
      results.push({
        source: 'claude',
        sessionId,
        title: meta.lastAiTitle ?? `未命名会话 ${sessionId.slice(0, 8)}`,
        projectDir: project.name,
        cwd: meta.cwd,
        lastModified: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
        // Claude transcripts have no thread-source concept.
        threadSource: undefined,
      });
    }
  }

  results.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
  return results;
}

/**
 * Locate the transcript file for a Claude session id by walking the project
 * directories (including nested dirs like `subagents/`) under the root.
 * Returns an absolute path, or undefined when not found.
 */
export function findClaudeSessionFile(sessionId: string, rootDir?: string): string | undefined {
  const root = resolve(rootDir ?? defaultClaudeSessionsRoot());
  const target = `${sessionId}.jsonl`;
  const walk = (dir: string): string | undefined => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const hit = walk(full);
        if (hit) {
          return hit;
        }
      } else if (entry.isFile() && entry.name === target) {
        return full;
      }
    }
    return undefined;
  };
  return walk(root);
}
