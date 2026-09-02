import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { MesaError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { actorRefOf, getAgent } from './agent-registry.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

/**
 * Per-member HTTP credentials (M3 phase 2, option B).
 *
 * Token fixes the identity; the agent registry fixes the permissions. A token
 * answers only "who is calling" — roles/capabilities are still resolved from
 * the registry on every connection, so a leaked member token grants at most
 * the (registry-bounded) powers of the one agent it was issued to, and audit
 * attribution stays truthful.
 *
 * Storage: one JSON file per token under `.agentmesa/tokens/`, named by the
 * sha256 hex of the token itself — lookup is a direct filename probe, no
 * per-entry comparison loop. The plaintext token exists ONLY in the return
 * value of {@link grantMemberToken}; it is never written to the event log,
 * projections, or any file.
 */
export interface StoredMemberToken {
  agentId: string;
  /** sha256 hex of the plaintext token — doubles as the storage filename. */
  tokenHash: string;
  /** ISO timestamp. */
  grantedAt: string;
  /** Actor ref of the granting operator. */
  grantedBy: string;
  /** Set by revokeMemberToken; a revoked token fails findMemberToken. */
  revokedAt?: string;
}

/** Listing view — never exposes hashes or plaintext. */
export interface MemberTokenSummary {
  agentId: string;
  grantedAt: string;
  grantedBy: string;
  revokedAt?: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenFilePath(ctx: MesaRuntimeContext, tokenHash: string): string {
  // tokenHash is a hex digest — encodeURIComponent is a no-op guard.
  return join(ctx.paths.tokensDir, `${encodeURIComponent(tokenHash)}.json`);
}

/**
 * Issue (or rotate) the token for an agent. One agent has at most one active
 * token: re-granting overwrites — the previous hash file is deleted and the
 * old token stops working immediately (no grace window, by design).
 * Rotation is therefore just another grant.
 */
export function grantMemberToken(
  ctx: MesaRuntimeContext,
  agentId: string
): { token: string; record: StoredMemberToken } {
  assertPolicy(ctx, 'token.grant', `token:${actorRefOf(agentId)}`);
  // Tokens lock a registry identity — the agent must already be registered.
  getAgent(ctx, agentId);

  const now = new Date().toISOString();
  const token = randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);

  // Supersede any previous active token for this agent (rotation semantics).
  const previous = findActiveTokenRecord(ctx, agentId);
  if (previous) {
    ctx.storage.delete(tokenFilePath(ctx, previous.tokenHash));
  }

  const record: StoredMemberToken = {
    agentId,
    tokenHash,
    grantedAt: now,
    grantedBy: actorRefOf(ctx.actor.id),
  };
  writeJsonToStorage(ctx, tokenFilePath(ctx, tokenHash), record);

  appendRuntimeEvent(ctx, {
    meetingId: 'workspace',
    type: 'token_granted',
    streamId: agentId,
    streamType: 'agent',
    data: {
      agentId,
      grantedBy: record.grantedBy,
      grantedAt: now,
      // Audit signal only — never the plaintext (or even the hash: the hash
      // is the storage filename, and the file already carries it).
      rotated: previous !== null,
    },
  });

  return { token, record };
}

/**
 * Revoke the active token of an agent. The record is kept (revokedAt set) for
 * audit; the token stops authenticating on the very next HTTP request.
 * Revoking an agent with no active token is an error, not a silent no-op —
 * operators should see when their mental model is stale.
 */
export function revokeMemberToken(
  ctx: MesaRuntimeContext,
  agentId: string,
  reason?: string
): MemberTokenSummary {
  assertPolicy(ctx, 'token.revoke', `token:${actorRefOf(agentId)}`);

  const active = findActiveTokenRecord(ctx, agentId);
  if (!active) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `No active token for agent "${agentId}". (Already revoked, or never granted.)`
    );
  }

  const now = new Date().toISOString();
  const revoked: StoredMemberToken = { ...active, revokedAt: now };
  writeJsonToStorage(ctx, tokenFilePath(ctx, active.tokenHash), revoked);

  appendRuntimeEvent(ctx, {
    meetingId: 'workspace',
    type: 'token_revoked',
    streamId: agentId,
    streamType: 'agent',
    data: {
      agentId,
      revokedBy: actorRefOf(ctx.actor.id),
      revokedAt: now,
      ...(reason ? { reason } : {}),
    },
  });

  return toSummary(revoked);
}

/**
 * Resolve a presented token to its agent. Hot path (every HTTP request):
 * sha256 the token and probe the file directly — O(1), no comparison loop.
 * Unknown or revoked tokens return null (callers treat them as
 * unauthenticated).
 */
export function findMemberToken(
  ctx: MesaRuntimeContext,
  token: string
): { agentId: string; record: StoredMemberToken } | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const record = readJsonFromStorage<StoredMemberToken>(
    ctx,
    tokenFilePath(ctx, sha256Hex(token))
  );
  if (!record || record.revokedAt) {
    return null;
  }
  return { agentId: record.agentId, record };
}

export function listMemberTokens(ctx: MesaRuntimeContext): MemberTokenSummary[] {
  return listJsonFromStorage<StoredMemberToken>(ctx, ctx.paths.tokensDir)
    .map(toSummary)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function findActiveTokenRecord(
  ctx: MesaRuntimeContext,
  agentId: string
): StoredMemberToken | null {
  const records = listJsonFromStorage<StoredMemberToken>(ctx, ctx.paths.tokensDir);
  return (
    records.find((r) => r.agentId === agentId && !r.revokedAt) ?? null
  );
}

function toSummary(record: StoredMemberToken): MemberTokenSummary {
  return {
    agentId: record.agentId,
    grantedAt: record.grantedAt,
    grantedBy: record.grantedBy,
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
  };
}
