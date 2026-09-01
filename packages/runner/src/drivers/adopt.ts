import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MesaError } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { DriverKind } from './types.js';
import { saveDriverSessionHandle } from './resolve.js';

/**
 * External-session adoption (session takeover).
 *
 * Seeds the driver-session sidecar with a handle pointing at a session that
 * was created *outside* AgentMesa (e.g. a Claude Code conversation started in
 * the user's terminal, or a Codex app-server thread). The next
 * `executeDriverTurn` for this agent+scope resumes that session instead of
 * creating a fresh one.
 *
 * Adoption is deliberately fail-loud: a handle that cannot possibly resume
 * (e.g. a Claude session whose local transcript is missing) must be rejected
 * here, not silently discovered as a broken resume later.
 */

const DRIVER_KINDS: readonly DriverKind[] = ['claude-agent-sdk', 'codex-app-server'];

export interface AdoptExternalDriverInput {
  /** Agent whose handle record receives the session. */
  agentId: string;
  /** Scope key (meetingId / taskId / '_global') — see `driverSessionScope`. */
  scope: string;
  /** Which deep-driver backend owns the session. */
  kind: DriverKind;
  /** Backend-native session/conversation id to adopt. */
  backendSessionId: string;
  /**
   * Optional override for the Claude projects root (default
   * `~/.claude/projects`). Test injection point for the transcript precheck.
   */
  claudeProjectsRoot?: string;
}

function isDriverKind(value: unknown): value is DriverKind {
  return typeof value === 'string' && (DRIVER_KINDS as readonly string[]).includes(value);
}

function assertNonEmpty(label: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MesaError('VALIDATION_ERROR', `adoptExternalDriverSession: ${label} must be a non-empty string`);
  }
}

/**
 * Look for `<projectsRoot>/<project-slug>/<backendSessionId>.jsonl`.
 *
 * Performance/scope note: only the *direct* files inside each project slug
 * directory are listed — no recursive descent. External main-session
 * transcripts are always direct children of a project directory, and subagent
 * transcripts also live in the same project directory in current Claude Code
 * layouts, so a bounded one-level scan is sufficient while keeping the cost
 * proportional to the number of projects (readdir per project dir, no stat
 * storm on transcript contents).
 */
function findClaudeTranscript(projectsRoot: string, backendSessionId: string): string | undefined {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // Missing or unreadable projects root → no transcript found.
    return undefined;
  }
  const wanted = `${backendSessionId}.jsonl`;
  for (const projectDir of projectDirs) {
    const candidate = join(projectsRoot, projectDir, wanted);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Adopt an externally-created driver session: validate the input, run the
 * kind-specific availability precheck, then persist the handle via
 * `saveDriverSessionHandle`.
 *
 * Prechecks by kind:
 * - `claude-agent-sdk`: the SDK resume path replays the local JSONL
 *   transcript, so a missing `~/.claude/projects/<slug>/<id>.jsonl` guarantees a
 *   dead handle. We probe for it here and fail loudly (the error names the
 *   backendSessionId and the searched root).
 * - `codex-app-server`: resume is an immediate RPC against the running
 *   app-server — there is no synchronous local artifact to probe, so any
 *   invalid thread id surfaces at resume time. Only shape validation applies.
 */
export function adoptExternalDriverSession(
  ctx: MesaRuntimeContext,
  input: AdoptExternalDriverInput,
): void {
  assertNonEmpty('agentId', input?.agentId);
  assertNonEmpty('scope', input?.scope);
  assertNonEmpty('backendSessionId', input?.backendSessionId);
  if (!isDriverKind(input?.kind)) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `adoptExternalDriverSession: kind must be one of ${DRIVER_KINDS.join(' | ')} (got: ${String(input?.kind)})`,
    );
  }

  if (input.kind === 'claude-agent-sdk') {
    const projectsRoot = input.claudeProjectsRoot ?? join(homedir(), '.claude', 'projects');
    const transcript = findClaudeTranscript(projectsRoot, input.backendSessionId);
    if (transcript === undefined) {
      throw new MesaError(
        'VALIDATION_ERROR',
        `adoptExternalDriverSession: no Claude transcript "${input.backendSessionId}.jsonl" found under "${projectsRoot}" (resume requires the local session transcript)`,
      );
    }
  }
  // codex-app-server: no synchronous precheck — see doc comment above.

  saveDriverSessionHandle(
    ctx,
    input.agentId,
    input.scope,
    {
      kind: input.kind,
      backendSessionId: input.backendSessionId,
      createdAt: new Date().toISOString(),
    },
  );
}
