import { describe, it, expect, vi } from 'vitest';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { DriverPermissionRequest } from '../types.js';
import {
  attachPermissionResponder,
  createPolicyPermissionResponder,
  DEFAULT_COMMAND_ALLOWLIST,
} from '../permission-bridge.js';
import type { PermissionDecisionRecord } from '../permission-bridge.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function request(
  kind: DriverPermissionRequest['kind'],
  detail: unknown,
  title = `${kind}: fixture`,
): DriverPermissionRequest {
  return { requestId: `req-${kind}-${Math.random().toString(36).slice(2, 8)}`, kind, title, detail };
}

function records(): {
  log: PermissionDecisionRecord[];
  onDecision: (record: PermissionDecisionRecord) => void;
} {
  const log: PermissionDecisionRecord[] = [];
  return { log, onDecision: (record: PermissionDecisionRecord) => void log.push(record) };
}

function fakeCtx(roles: string[]): MesaRuntimeContext {
  return {
    rootDir: 'E:\\ws',
    actor: { id: 'agent-1', type: 'agent', roles },
    policy: {
      can: () => ({ allowed: true }),
      canWithContext: () => ({ allowed: true }),
    },
  } as unknown as MesaRuntimeContext;
}

// ---------------------------------------------------------------------------
// command kind
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — command', () => {
  it('allows an allowlisted command for a role with run_command', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('allow');
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'command.allow', resource: 'pnpm test' });
  });

  it('denies a command outside the allowlist', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(
      responder(request('command', { command: 'curl https://example.com' })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'command.not_allowlisted' });
    expect(log[0]?.reason).toContain('curl');
  });

  it('denies blocked commands (sudo)', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['builder'] });
    const decision = await responder(request('command', { command: 'sudo npm test' }));
    expect(decision).toBe('deny');
  });

  it('denies commands referencing secret paths', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(responder(request('command', { command: 'cat .env' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'command.secret_path' });
  });

  it('denies allowlisted commands for roles without run_command', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['reviewer'], onDecision });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'command.capability' });
  });

  it('allows allowlisted commands for the owner role (core bypass parity)', async () => {
    // Owner mirrors core's owner bypass: the role table must carry
    // run_command, otherwise the bridge denies what core allows.
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['owner'], onDecision });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('allow');
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'command.allow' });
  });

  it('honors the prefix-match semantics of the allowlist', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['tester'] });
    await expect(
      responder(request('command', { command: 'git log --oneline -5' })),
    ).resolves.toBe('allow');
  });

  it('supports extra allowlist entries and string detail payloads', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      commandAllowlist: [...DEFAULT_COMMAND_ALLOWLIST, 'python build.py'],
    });
    await expect(responder(request('command', 'python build.py --fast'))).resolves.toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// patch kind
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — patch', () => {
  it('allows a patch within write scope for the role', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(
      responder(request('patch', { changes: [{ path: 'src/main.ts', kind: 'modify' }] })),
    ).resolves.toBe('allow');
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'patch.allow' });
  });

  it('denies a patch touching a secret path', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(
      responder(request('patch', { changes: [{ path: 'secrets/api.json' }] })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'patch.secret_path' });
  });

  it('denies a patch out of the role write scope (reviewer editing .ts)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['reviewer'], onDecision });
    await expect(
      responder(request('patch', { file_path: 'src/main.ts', diff: '...' })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'patch.out_of_scope' });
  });

  it('relativizes absolute paths against the workspace root for rule matching', async () => {
    // `.agentmesa/**` denies builder — the match only works once the absolute
    // path is relativized against the workspace root.
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      workspaceRootDir: 'E:\\ws',
    });
    await expect(
      responder(request('patch', { path: 'E:\\ws\\.agentmesa\\config.json' })),
    ).resolves.toBe('deny');
  });

  it('denies patches with no parsable path (fail-closed)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(responder(request('patch', { itemId: 'item-42' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'patch.unparsed' });
  });

  it('judges a grantRoot-only payload by the granted scope', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['builder'] });
    await expect(responder(request('patch', { grantRoot: 'src' }))).resolves.toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// tool kind
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — tool', () => {
  it('allows a mapped write tool for a role with modify_source', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(
      responder(request('tool', { toolName: 'Write', input: { file_path: 'src/a.ts' } })),
    ).resolves.toBe('allow');
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'tool.allow', resource: 'Write' });
  });

  it('denies a mapped tool when the role lacks the capability', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['reviewer'], onDecision });
    await expect(
      responder(request('tool', { toolName: 'Write', input: { file_path: 'src/a.ts' } })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'tool.capability' });
    expect(log[0]?.reason).toContain('modify_source');
  });

  it('denies a write tool targeting a secret path', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['builder'] });
    await expect(
      responder(request('tool', { toolName: 'Edit', input: { file_path: '.env' } })),
    ).resolves.toBe('deny');
  });

  it('maps Bash to run_command', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['tester'] });
    await expect(
      responder(request('tool', { toolName: 'Bash', input: { command: 'pnpm test' } })),
    ).resolves.toBe('allow');
    const denied = createPolicyPermissionResponder({ roles: ['documenter'] });
    await expect(
      denied(request('tool', { toolName: 'Bash', input: { command: 'pnpm test' } })),
    ).resolves.toBe('deny');
  });

  it('allows known read-only tools without a capability check', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['custom'] });
    await expect(responder(request('tool', { toolName: 'Read' }))).resolves.toBe('allow');
  });

  it('denies unknown tools by default (conservative)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(
      responder(request('tool', { toolName: 'McpFancyTool' })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'tool.unknown' });
  });

  it('allows unknown tools when unknownToolPolicy is configured', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      unknownToolPolicy: 'allow',
    });
    await expect(responder(request('tool', { toolName: 'McpFancyTool' }))).resolves.toBe('allow');
  });

  it('supports custom tool policy mappings', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['researcher'],
      toolPolicyMap: { mcp__kb__search: 'readonly' },
    });
    await expect(
      responder(request('tool', { toolName: 'mcp__kb__search' })),
    ).resolves.toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// fail-closed
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — fail-closed', () => {
  it('denies unparsable payloads of every kind', async () => {
    const responder = createPolicyPermissionResponder({ roles: ['builder'] });
    await expect(responder(request('command', 42))).resolves.toBe('deny');
    await expect(responder(request('command', {}))).resolves.toBe('deny');
    await expect(responder(request('command', null))).resolves.toBe('deny');
    await expect(responder(request('tool', { input: {} }))).resolves.toBe('deny');
    await expect(responder(request('tool', ['nope']))).resolves.toBe('deny');
    await expect(responder(request('patch', { reason: 'file change' }))).resolves.toBe('deny');
  });

  it('denies when no identity is supplied (no roles → no capabilities)', async () => {
    const responder = createPolicyPermissionResponder({});
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('deny');
    await expect(
      responder(request('tool', { toolName: 'Write', input: { file_path: 'a.ts' } })),
    ).resolves.toBe('deny');
  });

  it('denies when a checker throws (bridge.error)', async () => {
    const throwing = {
      isAllowed: () => {
        throw new Error('checker exploded');
      },
    };
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      commandChecker: throwing as never,
    });
    const { log, onDecision } = records();
    const withAudit = createPolicyPermissionResponder({
      roles: ['builder'],
      commandChecker: throwing as never,
      onDecision,
    });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('deny');
    await expect(withAudit(request('command', { command: 'pnpm test' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'bridge.error' });
    expect(log[0]?.reason).toContain('checker exploded');
  });
});

// ---------------------------------------------------------------------------
// askHuman gate
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — askHuman', () => {
  const pushCommand = () => request('command', { command: 'git push origin main' });

  it('denies approval-required commands when no human gate is configured', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({ roles: ['builder'], onDecision });
    await expect(responder(pushCommand())).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'approval.required' });
  });

  it('asks the human when policy allows but requires approval — deny wins', async () => {
    const askHuman = vi.fn(async () => 'deny' as const);
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      askHuman,
      onDecision,
    });
    await expect(responder(pushCommand())).resolves.toBe('deny');
    expect(askHuman).toHaveBeenCalledTimes(1);
    expect(log[0]).toMatchObject({
      decision: 'deny',
      rule: 'human.denied',
      viaHuman: true,
    });
  });

  it('asks the human when policy allows but requires approval — allow wins', async () => {
    const askHuman = vi.fn(async () => 'allow' as const);
    const responder = createPolicyPermissionResponder({ roles: ['builder'], askHuman });
    await expect(responder(pushCommand())).resolves.toBe('allow');
    expect(askHuman).toHaveBeenCalledTimes(1);
  });

  it('never asks the human for policy-denied operations', async () => {
    const askHuman = vi.fn(async () => 'allow' as const);
    const responder = createPolicyPermissionResponder({
      roles: ['reviewer'], // no run_command, and curl is off-allowlist
      askHuman,
    });
    await expect(responder(pushCommand())).resolves.toBe('deny');
    await expect(
      responder(request('command', { command: 'curl https://example.com' })),
    ).resolves.toBe('deny');
    expect(askHuman).not.toHaveBeenCalled();
  });

  it('treats a throwing human gate as deny', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      askHuman: async () => {
        throw new Error('gate down');
      },
    });
    await expect(responder(pushCommand())).resolves.toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// audit callback
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — onDecision', () => {
  it('reports every decision with kind, verdict, rule, reason and roles', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      actor: { id: 'agent-7', type: 'agent', roles: ['builder', 'tester'] },
      onDecision,
    });
    await responder(request('command', { command: 'pnpm test' }));
    await responder(request('tool', { toolName: 'NopeTool' }));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      actorId: 'agent-7',
      roles: ['builder', 'tester'],
      kind: 'command',
      decision: 'allow',
      requestId: expect.any(String) as string,
      timestamp: expect.any(String) as string,
    });
    expect(typeof log[0]?.reason).toBe('string');
    expect(log[1]).toMatchObject({ kind: 'tool', decision: 'deny' });
  });

  it('swallows onDecision failures without changing the verdict', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      onDecision: () => {
        throw new Error('audit sink down');
      },
    });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// attachPermissionResponder (MesaRuntimeContext bridge)
// ---------------------------------------------------------------------------

describe('attachPermissionResponder', () => {
  it('builds a responder from ctx (actor roles + workspace root + core policy)', async () => {
    const ctx = fakeCtx(['builder']);
    const options = attachPermissionResponder({ dryRun: false }, { ctx });
    expect(typeof options.permissionResponder).toBe('function');
    await expect(
      options.permissionResponder(request('command', { command: 'pnpm test' })),
    ).resolves.toBe('allow');
    // Absolute path against ctx.rootDir is relativized before rule matching.
    await expect(
      options.permissionResponder(request('patch', { path: 'E:\\ws\\.agentmesa\\state.json' })),
    ).resolves.toBe('deny');
  });

  it('does not mutate the incoming executor options', () => {
    const ctx = fakeCtx(['builder']);
    const original = { dryRun: true };
    const options = attachPermissionResponder(original, { ctx });
    expect((original as Record<string, unknown>).permissionResponder).toBeUndefined();
    expect(options.dryRun).toBe(true);
    expect(options.permissionResponder).toBeDefined();
  });

  it('consults ctx.policy for tool actions with a core mapping', async () => {
    const ctx = fakeCtx(['builder']);
    const denying = {
      ...ctx,
      policy: {
        can: () => ({ allowed: false, reason: 'workspace policy forbids artifact creation' }),
        canWithContext: () => ({ allowed: false }),
      },
    } as unknown as MesaRuntimeContext;
    const options = attachPermissionResponder({}, { ctx: denying });
    await expect(
      options.permissionResponder(request('tool', { toolName: 'create_artifact' })),
    ).resolves.toBe('deny');

    const allowed = attachPermissionResponder({}, { ctx: denying, useCorePolicy: false });
    await expect(
      allowed.permissionResponder(request('tool', { toolName: 'create_artifact' })),
    ).resolves.toBe('allow');
  });

  it('uses the supplied actor over ctx.actor when given', async () => {
    const ctx = fakeCtx(['builder']);
    const options = attachPermissionResponder(
      {},
      { ctx, actor: { id: 'agent-9', type: 'agent', roles: ['reviewer'] } },
    );
    await expect(
      options.permissionResponder(request('command', { command: 'pnpm test' })),
    ).resolves.toBe('deny');
  });

  it('passes speechGuard through to the responder', async () => {
    const ctx = fakeCtx(['owner']);
    const options = attachPermissionResponder({}, { ctx, speechGuard: true });
    await expect(
      options.permissionResponder(request('patch', { path: 'src/main.ts' })),
    ).resolves.toBe('deny');
    await expect(
      options.permissionResponder(request('command', { command: 'git status' })),
    ).resolves.toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// speechGuard — read-only-by-default fence with human-approval escalation
// ---------------------------------------------------------------------------

describe('createPolicyPermissionResponder — speechGuard', () => {
  it('escalates every patch to the human gate; fail-closed without askHuman, even for owner', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['owner'],
      speechGuard: true,
      onDecision,
    });
    await expect(
      responder(request('patch', { changes: [{ path: 'src/main.ts', kind: 'modify' }] })),
    ).resolves.toBe('deny');
    // No askHuman gate configured → the escalation verdict is overwritten by
    // the fail-closed 'approval.required' rule.
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'approval.required' });
    expect(log[0]?.reason).toContain('read-only');
    expect(log[0]?.reason).toContain('no human approval gate');
  });

  it('fail-closes builder patches in a speech turn too (no askHuman gate)', async () => {
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
    });
    await expect(
      responder(request('patch', { file_path: 'src/main.ts', diff: '...' })),
    ).resolves.toBe('deny');
  });

  it('routes speech patches through askHuman — the human decision wins', async () => {
    const askHuman = vi.fn(async () => 'allow' as const);
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
      askHuman,
      onDecision,
    });
    await expect(
      responder(request('patch', { changes: [{ path: 'src/main.ts', kind: 'modify' }] })),
    ).resolves.toBe('allow');
    expect(askHuman).toHaveBeenCalledTimes(1);
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'human.approved', viaHuman: true });
  });

  it('allows read-only commands in a speech turn (git status)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
      onDecision,
    });
    await expect(responder(request('command', { command: 'git status' }))).resolves.toBe('allow');
    expect(log[0]).toMatchObject({ decision: 'allow', rule: 'speech.command_allow' });
  });

  it('escalates allowlisted but non-read-only commands (pnpm test, builder) — fail-closed without a gate', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
      onDecision,
    });
    await expect(responder(request('command', { command: 'pnpm test' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'approval.required' });
    expect(log[0]?.reason).toContain('read-only');
    expect(log[0]?.reason).toContain('no human approval gate');
  });

  it('gates approval-required speech commands to a human (git push) — the takeover deadlock fix', async () => {
    const askHuman = vi.fn(async () => 'deny' as const);
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
      askHuman,
      onDecision,
    });
    await expect(responder(request('command', { command: 'git push origin main' }))).resolves.toBe(
      'deny',
    );
    expect(askHuman).toHaveBeenCalledTimes(1);
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'human.denied', viaHuman: true });
  });

  it('keeps blocked and secret-path command checks ahead of the fence', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['owner'],
      speechGuard: true,
      onDecision,
    });
    await expect(responder(request('command', { command: 'cat .env' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'command.secret_path' });
  });

  it('escalates mutating tools (Write, Bash) and allows read-only tools (Read, Grep)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['builder'],
      speechGuard: true,
      onDecision,
    });
    // No askHuman gate → fail-closed ('approval.required' overwrite), but the
    // reason still names the speech escalation.
    await expect(
      responder(request('tool', { toolName: 'Write', input: { file_path: 'src/a.ts' } })),
    ).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'approval.required' });
    expect(log[0]?.reason).toContain('read-only');
    await expect(
      responder(request('tool', { toolName: 'Bash', input: { command: 'git status' } })),
    ).resolves.toBe('deny');
    expect(log[1]).toMatchObject({ decision: 'deny', rule: 'approval.required' });
    await expect(responder(request('tool', { toolName: 'Read' }))).resolves.toBe('allow');
    expect(log[2]).toMatchObject({ decision: 'allow', rule: 'tool.readonly' });
    await expect(responder(request('tool', { toolName: 'Grep' }))).resolves.toBe('allow');
  });

  it('still blocks a speech command for a role without run_command (capability first)', async () => {
    const { log, onDecision } = records();
    const responder = createPolicyPermissionResponder({
      roles: ['reviewer'],
      speechGuard: true,
      onDecision,
    });
    await expect(responder(request('command', { command: 'git status' }))).resolves.toBe('deny');
    expect(log[0]).toMatchObject({ decision: 'deny', rule: 'command.capability' });
  });
});
