/**
 * Claude Code / Mana transcript parser.
 *
 * Reads a single `<sessionId>.jsonl` transcript and normalizes it into a
 * `ParsedExternalSession` timeline. Only `user` / `assistant` records become
 * messages; `ai-title`, `last-prompt`, `attachment`, `mode`,
 * `queue-operation` and other bookkeeping lines are skipped (ai-title feeds
 * the summary title).
 *
 * Host-injected user payloads (`<recovered_conversation_context>`,
 * `<task-notification>`) are dropped so the imported timeline only contains
 * real conversation turns.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type {
  ExternalMessage,
  ExternalSessionParseOptions,
  ExternalSessionSummary,
  ParsedExternalSession,
} from './types.js';

const DEFAULT_MAX_BODY_LENGTH = 8_000;
const SUMMARY_MAX_LENGTH = 80;
const ARGS_DIGEST_MAX_LENGTH = 60;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/** Speaker ids used on the imported timeline. */
const USER_SPEAKER = 'user:imported-claude';
const AGENT_SPEAKER = 'agent:claude-external';

/** User-content strings starting with any of these are host injections. */
const INJECTED_PREFIXES = ['<recovered_conversation_context>', '<task-notification>'];

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** One-line digest used as `summary`: first physical line, whitespace-collapsed. */
function summarize(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return truncate(collapsed, SUMMARY_MAX_LENGTH);
}

function serializeBlockContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content === undefined || content === null) {
    return '';
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

interface ClaudeLine {
  type?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  aiTitle?: unknown;
  message?: {
    content?: unknown;
  };
}

export function parseClaudeSession(
  filePath: string,
  options?: ExternalSessionParseOptions,
): ParsedExternalSession {
  const maxBodyLength = options?.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
  const absPath = resolve(filePath);
  const stat = statSync(absPath);
  const sessionId = basename(absPath).replace(/\.jsonl$/, '');

  const messages: ExternalMessage[] = [];
  let title: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  // tool_use id -> tool name, so tool_result entries can carry a toolName.
  const toolNames = new Map<string, string>();

  const lines = readFileSync(absPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    let obj: ClaudeLine;
    try {
      obj = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }

    // First record with a timestamp marks the session start.
    if (startedAt === undefined && typeof obj.timestamp === 'string') {
      startedAt = obj.timestamp;
    }
    if (cwd === undefined && typeof obj.cwd === 'string') {
      cwd = obj.cwd;
    }

    if (obj.type === 'ai-title') {
      if (typeof obj.aiTitle === 'string') {
        title = obj.aiTitle;
      }
      continue;
    }

    if (obj.type !== 'user' && obj.type !== 'assistant') {
      // last-prompt / attachment / mode / queue-operation / … — skip.
      continue;
    }

    const createdAt = typeof obj.timestamp === 'string' ? obj.timestamp : startedAt ?? '';
    const content = obj.message?.content;

    if (obj.type === 'user') {
      if (typeof content === 'string') {
        const trimmed = content.trimStart();
        if (INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
          continue;
        }
        messages.push({
          kind: 'text',
          speaker: USER_SPEAKER,
          createdAt,
          summary: summarize(content),
          body: truncate(content, maxBodyLength),
        });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') {
            continue;
          }
          const b = block as { type?: unknown; tool_use_id?: unknown; content?: unknown };
          if (b.type !== 'tool_result') {
            continue;
          }
          const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined;
          const body = serializeBlockContent(b.content);
          const message: ExternalMessage = {
            kind: 'tool_result',
            // Tool results sit on the assistant side of the imported timeline.
            speaker: AGENT_SPEAKER,
            createdAt,
            summary: '工具结果',
            body: truncate(body, maxBodyLength),
          };
          if (toolUseId !== undefined && toolNames.has(toolUseId)) {
            message.toolName = toolNames.get(toolUseId);
          }
          messages.push(message);
        }
      }
      continue;
    }

    // assistant
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const b = block as {
        type?: unknown;
        text?: unknown;
        thinking?: unknown;
        id?: unknown;
        name?: unknown;
        input?: unknown;
      };
      if (b.type === 'text' && typeof b.text === 'string') {
        messages.push({
          kind: 'text',
          speaker: AGENT_SPEAKER,
          createdAt,
          summary: summarize(b.text),
          body: truncate(b.text, maxBodyLength),
        });
      } else if (b.type === 'tool_use') {
        const name = typeof b.name === 'string' ? b.name : '';
        if (typeof b.id === 'string' && name) {
          toolNames.set(b.id, name);
        }
        const args = serializeBlockContent(b.input ?? {});
        messages.push({
          kind: 'tool_use',
          speaker: AGENT_SPEAKER,
          createdAt,
          toolName: name,
          summary: `${name}(${truncate(args, ARGS_DIGEST_MAX_LENGTH)})`,
          body: truncate(args, maxBodyLength),
        });
      } else if (b.type === 'thinking') {
        const thinking = typeof b.thinking === 'string' ? b.thinking : '';
        messages.push({
          kind: 'thinking',
          speaker: AGENT_SPEAKER,
          createdAt,
          summary: summarize(thinking),
          body: truncate(thinking, maxBodyLength),
        });
      }
    }
  }

  const summary: ExternalSessionSummary = {
    source: 'claude',
    sessionId,
    title: title ?? `未命名会话 ${sessionId.slice(0, 8)}`,
    projectDir: basename(dirname(absPath)),
    cwd,
    lastModified: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
    threadSource: undefined,
  };

  return {
    summary,
    filePath: absPath,
    startedAt,
    messages,
  };
}
