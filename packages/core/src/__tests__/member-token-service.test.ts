import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { registerAgent } from '../services/agent-registry.js';
import {
  findMemberToken,
  grantMemberToken,
  listMemberTokens,
  revokeMemberToken,
} from '../services/member-token-service.js';

let testDir: string;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-tokens-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
  registerAgent(ctx, {
    id: 'agent:bot1',
    name: 'Bot One',
    client: 'remote',
    status: 'available',
    roles: ['builder'],
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('grantMemberToken', () => {
  it('issues a token that findMemberToken resolves back to the agent', () => {
    const { token, record } = grantMemberToken(ctx, 'agent:bot1');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(record.agentId).toBe('agent:bot1');
    expect(findMemberToken(ctx, token)?.agentId).toBe('agent:bot1');
  });

  it('refuses agents that are not registered', () => {
    expect(() => grantMemberToken(ctx, 'agent:ghost')).toThrow(/not found/i);
  });

  it('never writes the plaintext token (or its hash) into the event log', () => {
    const { token, record } = grantMemberToken(ctx, 'agent:bot1');
    const all = JSON.stringify(ctx.eventStore.list({}));
    const events = ctx.eventStore.list({ type: 'token_granted' });

    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('user:test');
    expect(all).not.toContain(token);
    expect(all).not.toContain(record.tokenHash);
  });

  it('rotating overwrites: the previous token stops resolving and its hash file disappears', () => {
    const first = grantMemberToken(ctx, 'agent:bot1');
    const second = grantMemberToken(ctx, 'agent:bot1');

    expect(first.token).not.toBe(second.token);
    expect(findMemberToken(ctx, first.token)).toBeNull();
    expect(findMemberToken(ctx, second.token)?.agentId).toBe('agent:bot1');
    expect(existsSync(join(ctx.paths.tokensDir, `${first.record.tokenHash}.json`))).toBe(false);
    expect(existsSync(join(ctx.paths.tokensDir, `${second.record.tokenHash}.json`))).toBe(true);
  });

  it('denies actors without manage_credentials', () => {
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:intruder', type: 'agent', roles: ['builder'] },
    });

    expect(() => grantMemberToken(deniedCtx, 'agent:bot1')).toThrow('Policy denied');
  });
});

describe('revokeMemberToken', () => {
  it('makes the token fail findMemberToken on the next lookup', () => {
    const { token } = grantMemberToken(ctx, 'agent:bot1');

    const summary = revokeMemberToken(ctx, 'agent:bot1', 'offboarded');
    expect(summary.revokedAt).toBeDefined();
    expect(findMemberToken(ctx, token)).toBeNull();
  });

  it('keeps the revoked record for audit (file retained, listed with revokedAt)', () => {
    const { record } = grantMemberToken(ctx, 'agent:bot1');
    revokeMemberToken(ctx, 'agent:bot1');

    // File is kept for audit, marked revoked.
    expect(existsSync(join(ctx.paths.tokensDir, `${record.tokenHash}.json`))).toBe(true);
    const listed = listMemberTokens(ctx);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.agentId).toBe('agent:bot1');
    expect(listed[0]!.revokedAt).toBeDefined();
  });

  it('emits a token_revoked event with the reason but no secrets', () => {
    const { token } = grantMemberToken(ctx, 'agent:bot1');
    revokeMemberToken(ctx, 'agent:bot1', 'offboarded');

    const events = ctx.eventStore.list({ type: 'token_revoked' });
    const serialized = JSON.stringify(events);

    expect(events).toHaveLength(1);
    expect((events[0]!.data as { reason?: string }).reason).toBe('offboarded');
    expect(serialized).not.toContain(token);
  });

  it('errors when there is no active token (no silent no-op)', () => {
    expect(() => revokeMemberToken(ctx, 'agent:bot1')).toThrow(/No active token/);
  });

  it('denies actors without manage_credentials', () => {
    grantMemberToken(ctx, 'agent:bot1');
    const deniedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'agent:intruder', type: 'agent', roles: ['reviewer'] },
    });

    expect(() => revokeMemberToken(deniedCtx, 'agent:bot1')).toThrow('Policy denied');
  });
});

describe('findMemberToken / listMemberTokens', () => {
  it('unknown and empty tokens resolve to null', () => {
    grantMemberToken(ctx, 'agent:bot1');

    expect(findMemberToken(ctx, 'deadbeef')).toBeNull();
    expect(findMemberToken(ctx, '')).toBeNull();
  });

  it('listing exposes no hashes or plaintext', () => {
    const { token, record } = grantMemberToken(ctx, 'agent:bot1');
    const serialized = JSON.stringify(listMemberTokens(ctx));

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(record.tokenHash);
  });
});
