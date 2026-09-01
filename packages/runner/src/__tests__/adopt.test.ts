import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeContext, initWorkspace } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import { adoptExternalDriverSession } from '../drivers/adopt.js';
import { loadDriverSessionHandle } from '../drivers/resolve.js';
import type { DriverKind } from '../drivers/types.js';

let testDir: string;
let ctx: MesaRuntimeContext;
let claudeRoot: string;

const SESSION_ID = 'b15a2c3d-1111-4222-8333-444455556666';

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-adopt-'));
  initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
  claudeRoot = mkdtempSync(join(tmpdir(), 'agentmesa-adopt-claude-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  rmSync(claudeRoot, { recursive: true, force: true });
});

/** Create a fake Claude projects layout: <root>/<slug>/<id>.jsonl. */
function seedClaudeTranscript(projectSlug: string, sessionId: string): void {
  const dir = join(claudeRoot, projectSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), '{"type":"user"}\n', 'utf-8');
}

describe('adoptExternalDriverSession', () => {
  it('seeds a claude handle that loadDriverSessionHandle reads back verbatim', () => {
    seedClaudeTranscript('E--some-project', SESSION_ID);

    adoptExternalDriverSession(ctx, {
      agentId: 'agent:claude',
      scope: 'meeting:m1',
      kind: 'claude-agent-sdk',
      backendSessionId: SESSION_ID,
      claudeProjectsRoot: claudeRoot,
    });

    const handle = loadDriverSessionHandle(ctx, 'agent:claude', 'meeting:m1');
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe('claude-agent-sdk');
    expect(handle!.backendSessionId).toBe(SESSION_ID);
    expect(handle!.createdAt).toBeTruthy();
    // Adopted handles carry the marker that activates strict resume semantics.
    expect(handle!.adopted).toBe(true);
  });

  it('rejects a claude session whose transcript is missing and writes no sidecar', () => {
    seedClaudeTranscript('E--some-project', SESSION_ID);
    const missingId = '00000000-0000-4000-8000-000000000000';

    expect(() =>
      adoptExternalDriverSession(ctx, {
        agentId: 'agent:claude',
        scope: 'meeting:m1',
        kind: 'claude-agent-sdk',
        backendSessionId: missingId,
        claudeProjectsRoot: claudeRoot,
      }),
    ).toThrow(/00000000-0000-4000-8000-000000000000/);
    // Fail-loud means fail-clean: nothing was persisted.
    expect(loadDriverSessionHandle(ctx, 'agent:claude', 'meeting:m1')).toBeUndefined();

    // A pre-existing handle in another scope must also survive untouched.
    adoptExternalDriverSession(ctx, {
      agentId: 'agent:claude',
      scope: 'meeting:other',
      kind: 'claude-agent-sdk',
      backendSessionId: SESSION_ID,
      claudeProjectsRoot: claudeRoot,
    });
    expect(() =>
      adoptExternalDriverSession(ctx, {
        agentId: 'agent:claude',
        scope: 'meeting:m1',
        kind: 'claude-agent-sdk',
        backendSessionId: missingId,
        claudeProjectsRoot: claudeRoot,
      }),
    ).toThrow();
    expect(loadDriverSessionHandle(ctx, 'agent:claude', 'meeting:other')).toBeDefined();
  });

  it('does not match non-jsonl or nested-only files during the claude precheck', () => {
    const dir = join(claudeRoot, 'proj-nested');
    mkdirSync(join(dir, 'subdir'), { recursive: true });
    writeFileSync(join(dir, 'plain.txt'), '', 'utf-8');
    writeFileSync(join(dir, 'subdir', `${SESSION_ID}.jsonl`), '', 'utf-8');

    expect(() =>
      adoptExternalDriverSession(ctx, {
        agentId: 'agent:claude',
        scope: '_global',
        kind: 'claude-agent-sdk',
        backendSessionId: SESSION_ID,
        claudeProjectsRoot: claudeRoot,
      }),
    ).toThrow(/no Claude transcript/);
  });

  it('adopts a codex session without any precheck (random id is fine)', () => {
    const backendSessionId = `thread-${Math.random().toString(36).slice(2)}`;
    adoptExternalDriverSession(ctx, {
      agentId: 'agent:codex',
      scope: 'task:t9',
      kind: 'codex-app-server',
      backendSessionId,
    });

    const handle = loadDriverSessionHandle(ctx, 'agent:codex', 'task:t9');
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe('codex-app-server');
    expect(handle!.backendSessionId).toBe(backendSessionId);
  });

  it('rejects invalid inputs (empty ids, illegal kind)', () => {
    const claudeInput = {
      agentId: 'agent:claude',
      scope: '_global',
      backendSessionId: SESSION_ID,
      claudeProjectsRoot: claudeRoot,
    } as const;

    expect(() =>
      adoptExternalDriverSession(ctx, { ...claudeInput, agentId: '', kind: 'claude-agent-sdk' }),
    ).toThrow(/agentId/);
    expect(() =>
      adoptExternalDriverSession(ctx, { ...claudeInput, agentId: '   ', kind: 'claude-agent-sdk' }),
    ).toThrow(/agentId/);
    expect(() =>
      adoptExternalDriverSession(ctx, { ...claudeInput, scope: '', kind: 'claude-agent-sdk' }),
    ).toThrow(/scope/);
    expect(() =>
      adoptExternalDriverSession(ctx, { ...claudeInput, backendSessionId: '', kind: 'claude-agent-sdk' }),
    ).toThrow(/backendSessionId/);
    expect(() =>
      adoptExternalDriverSession(ctx, {
        ...claudeInput,
        kind: 'not-a-driver' as unknown as DriverKind,
      }),
    ).toThrow(/kind/);

    // Nothing was persisted by any of the rejected calls.
    expect(loadDriverSessionHandle(ctx, 'agent:claude', '_global')).toBeUndefined();
  });

  it('round-trips an agentId containing ":" (filename sanitization is transparent)', () => {
    seedClaudeTranscript('proj-x', SESSION_ID);
    const agentId = 'agent:claude-external';

    adoptExternalDriverSession(ctx, {
      agentId,
      scope: 'meeting:with:colons',
      kind: 'claude-agent-sdk',
      backendSessionId: SESSION_ID,
      claudeProjectsRoot: claudeRoot,
    });

    const handle = loadDriverSessionHandle(ctx, agentId, 'meeting:with:colons');
    expect(handle).toBeDefined();
    expect(handle!.backendSessionId).toBe(SESSION_ID);
    // Sanitized filename, but the stored record keeps the raw agentId.
    expect(handle!.kind).toBe('claude-agent-sdk');
  });
});
