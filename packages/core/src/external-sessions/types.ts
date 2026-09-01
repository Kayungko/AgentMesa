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
  /** codex subagent threads only: the parent (spawning) thread id — group-hint on import. */
  parentThreadId?: string;
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
  /**
   * Stable line-level id from the source file (codex: `payload.id` like
   * `msg_*`/`ctc_*`/`fco_*`, falling back to `<sessionId>#<ordinal>`; claude:
   * the transcript line `uuid`). Anchors incremental refresh: the same source
   * line must map to the same id across re-imports.
   */
  externalLineId?: string;
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
  /**
   * Also list non-user codex threads (`subagent` / `guardian_review`). Default
   * false: subagent rollout files are named by the CHILD thread id (not the
   * resumable parent id), so they are import-visible only — adoption/resume
   * semantics still target the parent. Claude sessions have no thread source.
   */
  includeSubagents?: boolean;
}

/** Options shared by both parsers. */
export interface ExternalSessionParseOptions {
  /** Hard cap on body length per message (default 8_000 chars). */
  maxBodyLength?: number;
}
