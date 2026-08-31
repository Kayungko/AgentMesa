/**
 * Codex rollout session parser.
 *
 * Reads a single `rollout-*.jsonl` file and normalizes it into a
 * `ParsedExternalSession` timeline. Three top-level record types are handled:
 * - `session_meta`  → summary metadata (id / cwd / thread_source) + startedAt
 * - `response_item` → conversation content (messages, tool calls, reasoning)
 * - `event_msg`     → only task_started / task_complete (turn boundaries)
 *
 * `turn_context`, `world_state`, `inter_agent_communication_metadata` and
 * `compacted` top-level records are skipped. Encrypted payloads (reasoning,
 * compaction, agent_message) are NEVER decrypted — they become `encrypted`
 * placeholder entries.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type {
  ExternalMessage,
  ExternalSessionParseOptions,
  ExternalSessionSummary,
  ParsedExternalSession,
} from './types.js';
import { buildCodexTitle } from './codex-scanner.js';

const DEFAULT_MAX_BODY_LENGTH = 8_000;
const SUMMARY_MAX_LENGTH = 80;
const ARGS_DIGEST_MAX_LENGTH = 60;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const USER_SPEAKER = 'user:imported-codex';
const AGENT_SPEAKER = 'agent:codex-external';

/** Environment-injected user input_text prefixes that must be filtered out. */
const INJECTED_PREFIXES = ['# AGENTS.md', '<permissions'];

const ENCRYPTED_SUMMARY = '加密推理（不可读）';

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function summarize(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return truncate(collapsed, SUMMARY_MAX_LENGTH);
}

function serializeContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface CodexPayload {
  type?: unknown;
  id?: unknown;
  cwd?: unknown;
  thread_source?: unknown;
  role?: unknown;
  content?: unknown;
  name?: unknown;
  input?: unknown;
  arguments?: unknown;
  call_id?: unknown;
  output?: unknown;
}

interface CodexLine {
  timestamp?: unknown;
  type?: unknown;
  payload?: CodexPayload;
}

/** Fallback: extract the trailing UUID from `rollout-<ts>-<uuid>.jsonl`. */
function sessionIdFromFilename(filePath: string): string {
  const match = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.exec(
    basename(filePath),
  );
  return match ? match[0] : basename(filePath).replace(/\.jsonl$/, '');
}

export function parseCodexSession(
  filePath: string,
  options?: ExternalSessionParseOptions,
): ParsedExternalSession {
  const maxBodyLength = options?.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
  const absPath = resolve(filePath);
  const stat = statSync(absPath);

  const messages: ExternalMessage[] = [];
  let sessionMeta: CodexPayload | undefined;
  let startedAt: string | undefined;
  // call_id -> tool name, so tool outputs can carry a toolName.
  const toolNames = new Map<string, string>();

  const pushEncrypted = (createdAt: string): void => {
    messages.push({
      kind: 'encrypted',
      speaker: AGENT_SPEAKER,
      createdAt,
      summary: ENCRYPTED_SUMMARY,
    });
  };

  const lines = readFileSync(absPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    let obj: CodexLine;
    try {
      obj = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }

    if (obj.type === 'session_meta') {
      sessionMeta = obj.payload;
      if (typeof obj.timestamp === 'string') {
        startedAt = obj.timestamp;
      }
      continue;
    }

    // turn_context / world_state / inter_agent_communication_metadata /
    // compacted and unknown record types are skipped.
    if (obj.type === 'response_item') {
      const payload = obj.payload;
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      const createdAt = typeof obj.timestamp === 'string' ? obj.timestamp : startedAt ?? '';

      if (payload.type === 'message') {
        if (payload.role === 'developer') {
          continue;
        }
        if (!Array.isArray(payload.content)) {
          continue;
        }
        for (const block of payload.content) {
          if (!block || typeof block !== 'object') {
            continue;
          }
          const b = block as { type?: unknown; text?: unknown };
          if (payload.role === 'assistant') {
            if (b.type === 'output_text' && typeof b.text === 'string') {
              messages.push({
                kind: 'text',
                speaker: AGENT_SPEAKER,
                createdAt,
                summary: summarize(b.text),
                body: truncate(b.text, maxBodyLength),
              });
            }
          } else if (payload.role === 'user') {
            if (b.type === 'input_text' && typeof b.text === 'string') {
              const trimmed = b.text.trimStart();
              if (INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
                continue;
              }
              messages.push({
                kind: 'text',
                speaker: USER_SPEAKER,
                createdAt,
                summary: summarize(b.text),
                body: truncate(b.text, maxBodyLength),
              });
            }
          }
        }
      } else if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name : '';
        if (typeof payload.call_id === 'string' && name) {
          toolNames.set(payload.call_id, name);
        }
        // custom_tool_call carries `input` (string); function_call carries
        // `arguments` (JSON string). Normalize both to text.
        const raw = typeof payload.input === 'string'
          ? payload.input
          : typeof payload.arguments === 'string'
            ? payload.arguments
            : serializeContent(payload.input ?? payload.arguments ?? {});
        messages.push({
          kind: 'tool_use',
          speaker: AGENT_SPEAKER,
          createdAt,
          toolName: name,
          summary: `${name}(${truncate(raw, ARGS_DIGEST_MAX_LENGTH)})`,
          body: truncate(raw, maxBodyLength),
        });
      } else if (
        payload.type === 'custom_tool_call_output'
        || payload.type === 'function_call_output'
      ) {
        const output = serializeContent(payload.output);
        const message: ExternalMessage = {
          kind: 'tool_result',
          speaker: AGENT_SPEAKER,
          createdAt,
          summary: '工具结果',
          body: truncate(output, maxBodyLength),
        };
        if (typeof payload.call_id === 'string' && toolNames.has(payload.call_id)) {
          message.toolName = toolNames.get(payload.call_id);
        }
        messages.push(message);
      } else if (payload.type === 'reasoning') {
        // encrypted_content is deliberately not read.
        pushEncrypted(createdAt);
      } else if (payload.type === 'compaction' || payload.type === 'agent_message') {
        pushEncrypted(createdAt);
      }
      continue;
    }

    if (obj.type === 'event_msg') {
      const payload = obj.payload;
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      const createdAt = typeof obj.timestamp === 'string' ? obj.timestamp : startedAt ?? '';
      // Keep turn boundaries for timeline fidelity; item_completed and other
      // events are dropped.
      if (payload.type === 'task_started') {
        messages.push({
          kind: 'turn_boundary',
          speaker: AGENT_SPEAKER,
          createdAt,
          summary: 'turn 开始',
        });
      } else if (payload.type === 'task_complete') {
        messages.push({
          kind: 'turn_boundary',
          speaker: AGENT_SPEAKER,
          createdAt,
          summary: 'turn 完成',
        });
      }
    }
  }

  const sessionId = typeof sessionMeta?.id === 'string' && sessionMeta.id.length > 0
    ? sessionMeta.id
    : sessionIdFromFilename(absPath);
  const cwd = typeof sessionMeta?.cwd === 'string' ? sessionMeta.cwd : undefined;

  const summary: ExternalSessionSummary = {
    source: 'codex',
    sessionId,
    title: buildCodexTitle(absPath, cwd),
    cwd,
    lastModified: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
    threadSource: typeof sessionMeta?.thread_source === 'string'
      ? sessionMeta.thread_source
      : undefined,
  };

  return {
    summary,
    filePath: absPath,
    startedAt,
    messages,
  };
}
