/**
 * External session import — write a parsed external transcript (Claude Code /
 * Codex CLI) into an AgentMesa meeting snapshot.
 *
 * Performance contract: a transcript can hold thousands of entries, and
 * `appendMessage` costs a full event-log re-read + fsync + cross-process lock
 * per call. This service therefore NEVER goes through `appendMessage` — on
 * import AND on refresh (the P1 incremental refresh appends new lines
 * directly inside the same single-lock batch pattern). It creates the meeting
 * once (one `meeting_created` event), then writes every message file directly
 * inside a single `event_log` lock and appends exactly ONE `meeting_imported`
 * event at the end so SSE clients reload the timeline.
 */

import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  MesaEventSchema,
  MesaMessageSchema,
  currentProtocolVersion,
  generateEventId,
  generateMessageId,
} from '@agentmesa/protocol';
import type { MesaMessage } from '@agentmesa/protocol';
import type { MesaRuntimeContext } from '../runtime/types.js';
import type {
  ExternalMessage,
  ExternalSessionSource,
  ParsedExternalSession,
} from '../external-sessions/types.js';
import { parseClaudeSession } from '../external-sessions/claude-parser.js';
import { parseCodexSession } from '../external-sessions/codex-parser.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import { createMeeting } from './meeting-service.js';
import { getAgent, registerAgent } from './agent-registry.js';
import { readJsonFromStorage, writeJsonToStorage } from './runtime-service-utils.js';
import { withLock } from './lock-manager.js';
import { AgentNotFoundError, MesaError } from '../errors.js';

/** Kinds that become visible timeline messages. */
const IMPORTABLE_KINDS = new Set(['text', 'tool_use', 'tool_result']);

/** Import provenance stored on the meeting file and every imported message. */
interface ImportMetadata {
  source: ExternalSessionSource;
  externalSessionId: string;
  importedAt: string;
  /** Absolute path of the source transcript at import/refresh time. */
  sourceFilePath: string;
  /** Source file mtime (ISO) when the snapshot was taken — change detection anchor. */
  sourceLastModified: string;
  /** Source file size (bytes) when the snapshot was taken. */
  sourceSizeBytes: number;
  /** Present when this snapshot was produced by a refresh, not the first import. */
  refreshedAt?: string;
  /** Optional user-assigned group label (multi-session imports). */
  groupName?: string;
}

export interface ImportExternalSessionInput {
  source: ExternalSessionSource;
  sessionId: string;
  /** Already-parsed transcript (the caller ran the parser). */
  parsed: ParsedExternalSession;
  /** Alternate workspace root for the agent-registration context (test injection). */
  actorRootDir?: string;
  /**
   * Optional user-assigned group label (multi-session imports): stored on the
   * meeting metadata and prefixed to the title so the meeting list can group
   * related sessions (e.g. one coordinator + its worker threads).
   */
  groupName?: string;
}

export interface ImportExternalSessionResult {
  meetingId: string;
  messageCount: number;
}

/** Display/client metadata for a synthetic external-agent identity. */
const EXTERNAL_AGENT_PROFILE: Record<
  ExternalSessionSource,
  { name: string; client: string }
> = {
  claude: { name: 'Claude（外部导入）', client: 'claude-code' },
  codex: { name: 'Codex（外部导入）', client: 'codex' },
};

export function importExternalSession(
  ctx: MesaRuntimeContext,
  input: ImportExternalSessionInput
): ImportExternalSessionResult {
  // 1. Identity registration (idempotent): only the assistant side
  //    (`agent:<source>-external`) needs an agent record — bubbles render
  //    `user:*` speakers as right-side user bubbles with no registration.
  //    `user:imported-*` speakers are intentionally skipped.
  const agentSpeakers = [
    ...new Set(
      input.parsed.messages
        .map((message) => message.speaker)
        .filter((speaker) => speaker.startsWith('agent:'))
    ),
  ];
  for (const speaker of agentSpeakers) {
    registerExternalAgentIfNeeded(ctx, input.source, speaker, input.actorRootDir);
  }

  // 2. Create the meeting (one meeting_created event — this is the only
  //    service call that appends an event before the import batch).
  const baseTitle = input.parsed.summary.title?.trim() || `外部会话导入 ${input.sessionId}`;
  const groupName = input.groupName?.trim();
  const title = groupName ? `[${groupName}] ${baseTitle}` : baseTitle;
  const meeting = createMeeting(ctx, {
    title,
    purpose: `外部导入（${input.source} ${input.sessionId}）`,
  });

  // 3. One lock, one event: write all message files + meeting metadata + the
  //    single `meeting_imported` event under the event-log lock. Message files
  //    live in the same flat layout as message-service
  //    (`messages/<messageId>.json`), so listMessages / GET /api/meetings/:id
  //    pick them up without any read-path changes.
  const importedAt = new Date().toISOString();
  const metadata: ImportMetadata = {
    source: input.source,
    externalSessionId: input.sessionId,
    importedAt,
    sourceFilePath: input.parsed.filePath,
    sourceLastModified: input.parsed.summary.lastModified,
    sourceSizeBytes: input.parsed.summary.sizeBytes,
    ...(groupName ? { groupName } : {}),
  };

  const messageCount = withLock(ctx, 'event_log', () => {
    let count = 0;
    for (const message of input.parsed.messages) {
      // thinking / encrypted / turn_boundary are internal noise for the
      // meeting timeline (reasoning traces, unreadable encrypted payloads,
      // turn markers) — skipped rather than folded into body annotations.
      if (!IMPORTABLE_KINDS.has(message.kind)) {
        continue;
      }
      const imported = buildImportedMessage(meeting.id, message, metadata);
      writeJsonToStorage(ctx, join(ctx.paths.messagesDir, `${imported.id}.json`), imported);
      count += 1;
    }

    // createMeeting does not accept metadata, so patch the meeting file with
    // the import provenance while we already hold the lock.
    const meetingFile = readJsonFromStorage<Record<string, unknown>>(
      ctx,
      join(ctx.paths.meetingsDir, `${meeting.id}.json`)
    );
    if (meetingFile) {
      writeJsonToStorage(ctx, join(ctx.paths.meetingsDir, `${meeting.id}.json`), {
        ...meetingFile,
        metadata,
      });
    }

    appendMeetingImportedEvent(ctx, meeting.id, metadata, count, importedAt);

    return count;
  });

  return { meetingId: meeting.id, messageCount };
}

// ---------------------------------------------------------------------------
// Snapshot refresh (P1: incremental by externalLineId, replace as fallback)
// ---------------------------------------------------------------------------

export interface RefreshImportedMeetingOptions {
  /**
   * `'incremental'` (default): diff the parsed source against the existing
   * snapshot by `externalLineId` (multiset) — existing messages keep their
   * ids, new lines are appended, lines that vanished from the source (codex
   * compaction rewrites) are removed.
   * `'replace'`: force the P0 full rewrite (anchor-drift / repair escape
   * hatch; also the automatic fallback when the snapshot holds messages
   * without a line anchor).
   */
  mode?: 'incremental' | 'replace';
}

export interface RefreshImportedMeetingResult {
  meetingId: string;
  /** Total snapshot messages after the refresh (P0-compatible semantics). */
  messageCount: number;
  mode: 'incremental' | 'replace';
  /** Messages appended by this refresh (replace mode = the full rewrite count). */
  appendedCount: number;
  /** Messages removed by this refresh (vanished from the source, incl. compaction). */
  removedCount: number;
  /** True when an incremental request fell back to replace (unanchorable snapshot). */
  degradedToReplace?: boolean;
}

/** Minimal record extracted from an existing snapshot message file for diffing. */
export interface SnapshotMessageRecord {
  /** File name under messagesDir. */
  file: string;
  /** Line-level anchor; absent on pre-anchor imports (unanchorable). */
  externalLineId?: string;
  createdAt: string;
  id: string;
}

export interface SnapshotDiff {
  /** Source messages with no counterpart in the snapshot → write as new. */
  appended: ExternalMessage[];
  /** Snapshot files whose line anchor vanished from the source → delete. */
  removedFiles: string[];
  /** The snapshot holds messages without externalLineId → caller must replace. */
  unanchorable: boolean;
}

/**
 * Pure multiset diff between the existing snapshot and a fresh parse, keyed
 * by `externalLineId`. `externalLineId` is NOT unique per message (a codex
 * payload or a claude line can yield several messages sharing one anchor), so
 * occurrences are paired by ordinal: the i-th occurrence of a key on one side
 * matches the i-th occurrence on the other. Relies on the parsers'
 * determinism contract (same file → same parse order, see codex-parser's
 * line-anchor comment). No IO — safe for unit tests and the P2 watcher's
 * dry-run checks.
 */
export function diffSnapshot(
  existing: SnapshotMessageRecord[],
  parsed: ExternalMessage[]
): SnapshotDiff {
  const sorted = [...existing].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
  );
  if (sorted.some((record) => record.externalLineId === undefined)) {
    return { appended: [], removedFiles: [], unanchorable: true };
  }

  const importable = parsed.filter((message) => IMPORTABLE_KINDS.has(message.kind));
  const newCounts = new Map<string, number>();
  for (const message of importable) {
    const key = message.externalLineId ?? '';
    newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
  }
  const oldCounts = new Map<string, number>();
  for (const record of sorted) {
    const key = record.externalLineId!;
    oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
  }

  // Pair occurrences by ordinal: the i-th occurrence of a key on the new side
  // exists on the old side iff i < oldCount(key); otherwise it is new.
  const appended: ExternalMessage[] = [];
  const seenNew = new Map<string, number>();
  for (const message of importable) {
    const key = message.externalLineId ?? '';
    const ordinal = seenNew.get(key) ?? 0;
    seenNew.set(key, ordinal + 1);
    if (ordinal >= (oldCounts.get(key) ?? 0)) {
      appended.push(message);
    }
  }

  // Symmetrically: the i-th occurrence on the old side is stale iff the new
  // side has no i-th occurrence of that key.
  const removedFiles: string[] = [];
  const seenOld = new Map<string, number>();
  for (const record of sorted) {
    const key = record.externalLineId!;
    const ordinal = seenOld.get(key) ?? 0;
    seenOld.set(key, ordinal + 1);
    if (ordinal >= (newCounts.get(key) ?? 0)) {
      removedFiles.push(record.file);
    }
  }

  return { appended, removedFiles, unanchorable: false };
}

/**
 * Re-import the source transcript behind an imported meeting. P1 default is
 * incremental (see {@link RefreshImportedMeetingOptions}); messages the user
 * authored in the meeting AFTER the import are preserved in every mode — only
 * snapshot messages (same `metadata.externalSessionId`) are touched.
 */
export function refreshImportedMeeting(
  ctx: MesaRuntimeContext,
  meetingId: string,
  options?: RefreshImportedMeetingOptions
): RefreshImportedMeetingResult {
  const meetingFile = readJsonFromStorage<Record<string, unknown>>(
    ctx,
    join(ctx.paths.meetingsDir, `${meetingId}.json`)
  );
  if (!meetingFile) {
    throw new MesaError('MEETING_NOT_FOUND', `refreshImportedMeeting: meeting "${meetingId}" not found`);
  }
  const stored = meetingFile.metadata as Partial<ImportMetadata> | undefined;
  const source = stored?.source;
  const sourceFilePath = stored?.sourceFilePath;
  if ((source !== 'claude' && source !== 'codex') || typeof sourceFilePath !== 'string' || sourceFilePath.length === 0) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `refreshImportedMeeting: meeting "${meetingId}" has no refreshable import provenance (source/sourceFilePath missing — meetings imported before the refresh anchors landed must be re-imported)`,
    );
  }

  // Throws (fail-loud) when the source transcript was moved or deleted.
  const parsed = source === 'claude'
    ? parseClaudeSession(sourceFilePath)
    : parseCodexSession(sourceFilePath);

  const refreshedAt = new Date().toISOString();
  const metadata: ImportMetadata = {
    source,
    externalSessionId: stored!.externalSessionId ?? parsed.summary.sessionId,
    importedAt: stored!.importedAt ?? refreshedAt,
    refreshedAt,
    sourceFilePath: parsed.filePath,
    sourceLastModified: parsed.summary.lastModified,
    sourceSizeBytes: parsed.summary.sizeBytes,
  };

  const mode = options?.mode === 'replace' ? 'replace' : 'incremental';

  return withLock(ctx, 'event_log', () => {
    const existing = collectSnapshotMessages(ctx, meetingId, metadata.externalSessionId);

    // Unanchorable snapshots (pre-anchor imports) cannot be diffed — fall
    // back to a full replace, correctness first.
    const diff = mode === 'incremental'
      ? diffSnapshot(existing.map(snapshotRecordOf), parsed.messages)
      : undefined;
    if (diff?.unanchorable) {
      return executeReplaceRefresh(ctx, meetingId, meetingFile, metadata, parsed.messages, {
        degradedToReplace: true,
      });
    }
    if (mode === 'replace') {
      return executeReplaceRefresh(ctx, meetingId, meetingFile, metadata, parsed.messages, {});
    }
    return executeIncrementalRefresh(ctx, meetingId, meetingFile, metadata, existing, diff!);
  });
}

function executeReplaceRefresh(
  ctx: MesaRuntimeContext,
  meetingId: string,
  meetingFile: Record<string, unknown>,
  metadata: ImportMetadata,
  messages: ExternalMessage[],
  flags: { degradedToReplace?: boolean }
): RefreshImportedMeetingResult {
  // 1. Delete the previous snapshot's messages (provenance-matched only).
  const staleFiles = collectSnapshotMessages(ctx, meetingId, metadata.externalSessionId)
    .map((record) => record.file);
  for (const file of staleFiles) {
    try {
      unlinkSync(join(ctx.paths.messagesDir, file));
    } catch {
      // Already gone — nothing to do.
    }
  }

  // 2. Write the fresh snapshot (message ids regenerate from scratch).
  let count = 0;
  for (const message of messages) {
    if (!IMPORTABLE_KINDS.has(message.kind)) {
      continue;
    }
    const imported = buildImportedMessage(meetingId, message, metadata);
    writeJsonToStorage(ctx, join(ctx.paths.messagesDir, `${imported.id}.json`), imported);
    count += 1;
  }

  // 3. Refresh the meeting's source anchors (title/purpose stay untouched).
  writeJsonToStorage(ctx, join(ctx.paths.meetingsDir, `${meetingId}.json`), {
    ...meetingFile,
    metadata,
  });

  // 4. One event so SSE clients reload the timeline.
  appendMeetingImportedEvent(ctx, meetingId, metadata, count, metadata.refreshedAt!, {
    refreshed: true,
    mode: 'replace',
    appendedCount: count,
    removedCount: staleFiles.length,
  });

  return {
    meetingId,
    messageCount: count,
    mode: 'replace',
    appendedCount: count,
    removedCount: staleFiles.length,
    ...(flags.degradedToReplace === true ? { degradedToReplace: true } : {}),
  };
}

function executeIncrementalRefresh(
  ctx: MesaRuntimeContext,
  meetingId: string,
  meetingFile: Record<string, unknown>,
  metadata: ImportMetadata,
  existing: Array<{ file: string; message: Record<string, unknown> }>,
  diff: SnapshotDiff
): RefreshImportedMeetingResult {
  // 1. Remove snapshot messages whose line anchor vanished from the source
  //    (codex compaction rewrites the file — dropped lines must not linger).
  for (const file of diff.removedFiles) {
    try {
      unlinkSync(join(ctx.paths.messagesDir, file));
    } catch {
      // Already gone — nothing to do.
    }
  }

  // 2. Append the new lines with their source timestamps — the client sorts
  //    by createdAt, so history lands in the right place automatically.
  for (const message of diff.appended) {
    const imported = buildImportedMessage(meetingId, message, metadata);
    writeJsonToStorage(ctx, join(ctx.paths.messagesDir, `${imported.id}.json`), imported);
  }

  // 3. Refresh the anchors (also the only write on a zero-diff refresh).
  writeJsonToStorage(ctx, join(ctx.paths.meetingsDir, `${meetingId}.json`), {
    ...meetingFile,
    metadata,
  });

  const messageCount = existing.length - diff.removedFiles.length + diff.appended.length;

  // 4. One event ONLY when something actually changed — a zero-diff refresh
  //    must not trigger a pointless SSE reload for every connected client.
  if (diff.appended.length > 0 || diff.removedFiles.length > 0) {
    appendMeetingImportedEvent(ctx, meetingId, metadata, messageCount, metadata.refreshedAt!, {
      refreshed: true,
      mode: 'incremental',
      appendedCount: diff.appended.length,
      removedCount: diff.removedFiles.length,
    });
  }

  return {
    meetingId,
    messageCount,
    mode: 'incremental',
    appendedCount: diff.appended.length,
    removedCount: diff.removedFiles.length,
  };
}

/**
 * Snapshot message files (provenance-matched) with their parsed records —
 * one pass for both the replace path (file names) and the incremental path
 * (anchors for diffing).
 */
function collectSnapshotMessages(
  ctx: MesaRuntimeContext,
  meetingId: string,
  externalSessionId: string | undefined
): Array<{ file: string; message: Record<string, unknown> }> {
  let files: string[];
  try {
    files = readdirSync(ctx.paths.messagesDir);
  } catch {
    return [];
  }
  const snapshot: Array<{ file: string; message: Record<string, unknown> }> = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const message = readJsonFromStorage<Record<string, unknown>>(
      ctx,
      join(ctx.paths.messagesDir, file)
    );
    const meta = message?.metadata as Partial<ImportMetadata> | undefined;
    if (message?.meetingId !== meetingId) {
      continue;
    }
    if (meta?.source !== 'claude' && meta?.source !== 'codex') {
      continue; // user-authored message — preserved on refresh
    }
    if (externalSessionId !== undefined && meta.externalSessionId !== externalSessionId) {
      continue; // different import's snapshot
    }
    if (message) {
      snapshot.push({ file, message });
    }
  }
  return snapshot;
}

/** Extract the diffable record shape from a collected snapshot message. */
export function snapshotRecordOf(
  entry: { file: string; message: Record<string, unknown> }
): SnapshotMessageRecord {
  // `externalLineId` is stamped by buildImportedMessage on top of the shared
  // ImportMetadata shape, so read it defensively from the raw record.
  const meta = entry.message.metadata as (Partial<ImportMetadata> & { externalLineId?: unknown }) | undefined;
  const lineId = meta?.externalLineId;
  return {
    file: entry.file,
    id: String(entry.message.id ?? ''),
    createdAt: String(entry.message.createdAt ?? ''),
    ...(typeof lineId === 'string' && lineId.length > 0 ? { externalLineId: lineId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Imported-session index (for the desk import list: imported / hasUpdates)
// ---------------------------------------------------------------------------

export interface ImportedExternalSessionInfo {
  meetingId: string;
  source: ExternalSessionSource;
  externalSessionId: string;
  sourceLastModified?: string;
  sourceSizeBytes?: number;
}

/**
 * All external-session imports in this workspace, keyed for the import list.
 * Reads the meetings directory directly (metadata lives on the meeting file,
 * not every consumer exposes it through the read API).
 */
export function listImportedExternalSessions(ctx: MesaRuntimeContext): ImportedExternalSessionInfo[] {
  let files: string[];
  try {
    files = readdirSync(ctx.paths.meetingsDir);
  } catch {
    return [];
  }
  const results: ImportedExternalSessionInfo[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const meeting = readJsonFromStorage<Record<string, unknown>>(
      ctx,
      join(ctx.paths.meetingsDir, file)
    );
    const metadata = meeting?.metadata as Partial<ImportMetadata> | undefined;
    if (!meeting || (metadata?.source !== 'claude' && metadata?.source !== 'codex')) {
      continue;
    }
    if (typeof metadata.externalSessionId !== 'string') {
      continue;
    }
    results.push({
      meetingId: String(meeting.id),
      source: metadata.source,
      externalSessionId: metadata.externalSessionId,
      ...(typeof metadata.sourceLastModified === 'string'
        ? { sourceLastModified: metadata.sourceLastModified }
        : {}),
      ...(typeof metadata.sourceSizeBytes === 'number'
        ? { sourceSizeBytes: metadata.sourceSizeBytes }
        : {}),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function appendMeetingImportedEvent(
  ctx: MesaRuntimeContext,
  meetingId: string,
  metadata: ImportMetadata,
  messageCount: number,
  timestamp: string,
  extra?: {
    refreshed?: boolean;
    mode?: 'incremental' | 'replace';
    appendedCount?: number;
    removedCount?: number;
  }
): void {
  // Bypass appendRuntimeEvent (it would re-acquire the event_log lock the
  // caller already holds) — mirror its append shape exactly instead.
  const sequence = ctx.eventStore.list({ streamId: meetingId }).length;
  ctx.eventStore.append(
    MesaEventSchema.parse({
      protocolVersion: currentProtocolVersion,
      id: generateEventId(),
      meetingId,
      type: 'meeting_imported',
      streamId: meetingId,
      streamType: 'meeting',
      data: {
        meetingId,
        source: metadata.source,
        externalSessionId: metadata.externalSessionId,
        messageCount,
        ...(extra?.refreshed === true ? { refreshed: true } : {}),
        ...(extra?.mode !== undefined ? { mode: extra.mode } : {}),
        ...(extra?.appendedCount !== undefined ? { appendedCount: extra.appendedCount } : {}),
        ...(extra?.removedCount !== undefined ? { removedCount: extra.removedCount } : {}),
      },
      actor: ctx.actor.id,
      sequence,
      timestamp,
    })
  );
}

function buildImportedMessage(
  meetingId: string,
  message: ExternalMessage,
  metadata: ImportMetadata
): MesaMessage {
  const summary = message.summary?.trim() || `[${message.kind}]`;
  const imported: MesaMessage = MesaMessageSchema.parse({
    protocolVersion: currentProtocolVersion,
    id: generateMessageId(),
    meetingId,
    from: message.speaker,
    type: 'general',
    summary,
    // body falls back to the one-line summary so tool entries without a full
    // body still render something meaningful in the timeline detail view.
    body: message.body ?? message.summary,
    createdAt: message.createdAt,
    metadata: {
      ...metadata,
      // Line-level anchor (codex payload.id / claude line uuid): the key the
      // incremental refresh diffs on. NOT unique per message — one source
      // line can yield several messages sharing it, so the diff treats it as
      // a multiset (see diffSnapshot).
      ...(message.externalLineId !== undefined
        ? { externalLineId: message.externalLineId }
        : {}),
    },
  });
  return imported;
}

function registerExternalAgentIfNeeded(
  ctx: MesaRuntimeContext,
  source: ExternalSessionSource,
  agentId: string,
  actorRootDir?: string
): void {
  // Registration may target a different root (test injection); the actor is
  // the importing identity either way.
  const regCtx =
    actorRootDir && actorRootDir !== ctx.rootDir
      ? createRuntimeContext({ rootDir: actorRootDir, actor: ctx.actor })
      : ctx;

  try {
    getAgent(regCtx, agentId);
    return; // already registered — idempotent
  } catch (error) {
    if (!(error instanceof AgentNotFoundError)) {
      throw error;
    }
  }

  const profile = EXTERNAL_AGENT_PROFILE[source];
  registerAgent(regCtx, {
    id: agentId,
    name: profile.name,
    client: profile.client,
    status: 'available',
    roles: ['builder'],
  });
}
