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
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import { createMeeting } from './meeting-service.js';
import { getAgent, registerAgent } from './agent-registry.js';
import { readJsonFromStorage, writeJsonToStorage } from './runtime-service-utils.js';
import { withLock } from './lock-manager.js';
import { AgentNotFoundError } from '../errors.js';

/** Kinds that become visible timeline messages. */
const IMPORTABLE_KINDS = new Set(['text', 'tool_use', 'tool_result']);

export interface ImportExternalSessionInput {
  source: ExternalSessionSource;
  sessionId: string;
  /** Already-parsed transcript (the caller ran the parser). */
  parsed: ParsedExternalSession;
  /** Alternate workspace root for the agent-registration context (test injection). */
  actorRootDir?: string;
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
  const title = input.parsed.summary.title?.trim() || `外部会话导入 ${input.sessionId}`;
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
  const metadata = {
    source: input.source,
    externalSessionId: input.sessionId,
    importedAt,
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

    // Bypass appendRuntimeEvent (it would re-acquire the event_log lock we
    // already hold) — mirror its append shape exactly instead.
    const sequence = ctx.eventStore.list({ streamId: meeting.id }).length;
    ctx.eventStore.append(
      MesaEventSchema.parse({
        protocolVersion: currentProtocolVersion,
        id: generateEventId(),
        meetingId: meeting.id,
        type: 'meeting_imported',
        streamId: meeting.id,
        streamType: 'meeting',
        data: {
          meetingId: meeting.id,
          source: input.source,
          externalSessionId: input.sessionId,
          messageCount: count,
        },
        actor: ctx.actor.id,
        sequence,
        timestamp: importedAt,
      })
    );

    return count;
  });

  return { meetingId: meeting.id, messageCount };
}

function buildImportedMessage(
  meetingId: string,
  message: ExternalMessage,
  metadata: { source: string; externalSessionId: string; importedAt: string }
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
    metadata,
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
