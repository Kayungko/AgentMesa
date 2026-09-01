/**
 * External session import — write a parsed external transcript (Claude Code /
 * Codex CLI) into an AgentMesa meeting snapshot.
 *
 * Performance contract: a transcript can hold thousands of entries, and
 * `appendMessage` costs a full event-log re-read + fsync + cross-process lock
 * per call. This service therefore NEVER goes through `appendMessage`. It
 * creates the meeting once (one `meeting_created` event), then writes every
 * message file directly inside a single `event_log` lock and appends exactly
 * ONE `meeting_imported` event at the end so SSE clients reload the timeline.
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
// Snapshot refresh (P0: replace-style)
// ---------------------------------------------------------------------------

export interface RefreshImportedMeetingResult {
  meetingId: string;
  messageCount: number;
}

/**
 * Re-import the source transcript behind an imported meeting: re-parse the
 * recorded source file, replace the imported snapshot messages (messages
 * carrying this import's provenance metadata), refresh the meeting's source
 * anchors, and append one `meeting_imported` event so SSE clients reload.
 *
 * Replace-style by design (P0): message ids are regenerated from scratch, so
 * any consumer keying on message ids sees a fresh set. Messages the user
 * authored in the meeting AFTER the import are preserved — only snapshot
 * messages (same `metadata.externalSessionId`) are replaced.
 */
export function refreshImportedMeeting(
  ctx: MesaRuntimeContext,
  meetingId: string
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

  const messageCount = withLock(ctx, 'event_log', () => {
    // 1. Delete the previous snapshot's messages (provenance-matched only).
    const staleFiles = collectSnapshotMessageFiles(ctx, meetingId, metadata.externalSessionId);
    for (const file of staleFiles) {
      try {
        unlinkSync(join(ctx.paths.messagesDir, file));
      } catch {
        // Already gone — nothing to do.
      }
    }

    // 2. Write the fresh snapshot.
    let count = 0;
    for (const message of parsed.messages) {
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
    appendMeetingImportedEvent(ctx, meetingId, metadata, count, refreshedAt, { refreshed: true });

    return count;
  });

  return { meetingId, messageCount };
}

/** Message files in the flat store belonging to this import snapshot. */
function collectSnapshotMessageFiles(
  ctx: MesaRuntimeContext,
  meetingId: string,
  externalSessionId: string | undefined
): string[] {
  let files: string[];
  try {
    files = readdirSync(ctx.paths.messagesDir);
  } catch {
    return [];
  }
  const stale: string[] = [];
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
    stale.push(file);
  }
  return stale;
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
  extra?: { refreshed?: boolean }
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
      // Line-level anchor: survives re-imports so P1 incremental refresh can
      // diff on it (codex payload.id / claude line uuid).
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
