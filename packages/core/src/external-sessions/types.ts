/**
 * External session import — shared types.
 *
 * Two sources are supported:
 * - `claude`: Claude Code / Mana transcript JSONL under `~/.claude/projects/<slug>/<uuid>.jsonl`
 * - `codex`:  Codex rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
 *
 * Scanners list sessions (cheap: read only the first line / file stat); parsers
 * stream a single session file into a normalized message timeline. The import
 * service consumes both to write an AgentMesa meeting snapshot.
 */

/** Where an external session came from. */
export type ExternalSessionSource = 'claude' | 'codex';

/** Codex thread source (from `session_meta.payload.thread_source`); Claude sessions have none. */
export type ExternalThreadSource = 'user' | 'subagent' | 'guardian_review' | string;

/** A session entry in the "list external sessions" result (scanner output, API-facing). */
export interface ExternalSessionSummary {
  source: ExternalSessionSource;
  /** claude: JSONL filename UUID; codex: `session_meta.payload.id`. */
  sessionId: string;
  /** claude: `ai-title` line value; codex: synthesized from timestamp + cwd. */
  title: string;
  /** claude: project directory slug (e.g. `E--AgentMesa`); codex: omitted. */
  projectDir?: string;
  /** Working directory recorded by the session, if known. */
  cwd?: string;
  /** File mtime, ISO-8601 UTC. */
  lastModified: string;
  sizeBytes: number;
  /** true when the file was modified within the last 5 minutes (likely in-flight). */
  active: boolean;
  /** codex only: `user` | `subagent` | `guardian_review`. Scanners list `user` threads by default. */
  threadSource?: ExternalThreadSource;
}

/** Normalized message kinds an external transcript is decomposed into. */
export type ExternalMessageKind =
  | 'text' // user input or assistant prose
  | 'thinking' // assistant reasoning (Claude `thinking` blocks; codex summaries)
  | 'tool_use' // assistant invoking a tool
  | 'tool_result' // tool output fed back
  | 'encrypted' // codex encrypted_content — unreadable placeholder
  | 'turn_boundary'; // codex task_started/task_complete (kept for timeline fidelity)

/** One normalized entry on the imported timeline. */
export interface ExternalMessage {
  kind: ExternalMessageKind;
  /** Speaker id convention: assistant side `agent:<source>-external`, user side `user:imported-<source>`, tool results inherit the tool user's speaker. */
  speaker: string;
  /** ISO-8601 UTC timestamp from the source file; falls back to the session start when a line has none. */
  createdAt: string;
  /** Human-readable one-liner (message summary / tool name+args digest). */
  summary: string;
  /** Full body; long tool outputs are truncated by the parser. */
  body?: string;
  /** Tool name for `tool_use` / `tool_result` kinds. */
  toolName?: string;
}

/** Parsed session ready for import. */
export interface ParsedExternalSession {
  summary: ExternalSessionSummary;
  /** Source-file path (for re-parse / audit). */
  filePath: string;
  /** Session start timestamp (first record's timestamp), ISO-8601 UTC. */
  startedAt?: string;
  messages: ExternalMessage[];
}

/** Options shared by both scanners. */
export interface ExternalSessionScanOptions {
  /** Override the source root (defaults: `~/.claude/projects` / `~/.codex/sessions`). Tests pass a fixture dir. */
  rootDir?: string;
  /** Only list sessions modified after this time (ISO). Optional. */
  modifiedSince?: string;
}

/** Options shared by both parsers. */
export interface ExternalSessionParseOptions {
  /** Hard cap on body length per message (default 8_000 chars). */
  maxBodyLength?: number;
}
