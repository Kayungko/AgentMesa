import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../workspace.js';
import type { MesaWorkspacePaths } from '../workspace.js';
import { createRuntimeContext } from '../runtime/create-runtime-context.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  createCheckResult,
  getCheckResult,
  listCheckResults,
} from '../services/check-result-service.js';
import { PolicyDeniedError } from '../errors.js';
import { RoleBasedPolicyEngine } from '../runtime/policy.js';

let testDir: string;
let paths: MesaWorkspacePaths;
let ctx: MesaRuntimeContext;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agentmesa-test-'));
  paths = initWorkspace(testDir);
  ctx = createRuntimeContext({
    rootDir: testDir,
    actor: { id: 'user:test', type: 'user', roles: ['owner'] },
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('createCheckResult', () => {
  it('creates a passed check result', () => {
    const check = createCheckResult(ctx, {
      taskId: 'task_test1234',
      status: 'passed',
      checkName: 'Unit Tests',
      success: true,
    });
    expect(check.id).toMatch(/^check_/);
    expect(check.taskId).toBe('task_test1234');
    expect(check.status).toBe('passed');
    expect(check.checkName).toBe('Unit Tests');
    expect(check.success).toBe(true);
    expect(check.kind).toBe('test');
    expect(check.exitCode).toBe(0);
    expect(check.protocolVersion).toBe('0.2.0');
    expect(check.createdAt).toBeTruthy();
  });

  it('honors explicit kind and optional fields', () => {
    const check = createCheckResult(ctx, {
      taskId: 'task_aaa',
      kind: 'lint',
      status: 'failed',
      checkName: 'ESLint',
      exitCode: 1,
      success: false,
      summary: 'ESLint: failure',
      detail: 'https://example.com/run/1',
    });
    expect(check.kind).toBe('lint');
    expect(check.exitCode).toBe(1);
    expect(check.summary).toBe('ESLint: failure');
    expect(check.detail).toBe('https://example.com/run/1');
  });

  it('generates unique check IDs', () => {
    const c1 = createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    const c2 = createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'B', success: true });
    expect(c1.id).not.toBe(c2.id);
  });

  it('writes the check result to disk', () => {
    const check = createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    const filePath = join(paths.checksDir, `${check.id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('appends a check_completed event', () => {
    const check = createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    const events = ctx.eventStore.list({ streamId: check.id });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('check_completed');
    expect(events[0]!.data.check).toBeDefined();
  });
});

describe('getCheckResult', () => {
  it('retrieves a created check result', () => {
    const created = createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    const fetched = getCheckResult(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('passed');
  });

  it('throws CheckResultNotFoundError for unknown check', () => {
    expect(() => getCheckResult(ctx, 'check_nonexist')).toThrow(/Check result not found/);
  });
});

describe('listCheckResults', () => {
  it('lists all check results', () => {
    createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    createCheckResult(ctx, { taskId: 'task_b', status: 'failed', checkName: 'B', success: false });
    expect(listCheckResults(ctx)).toHaveLength(2);
  });

  it('filters by taskId', () => {
    createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    createCheckResult(ctx, { taskId: 'task_b', status: 'passed', checkName: 'B', success: true });
    const filtered = listCheckResults(ctx, { taskId: 'task_a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.taskId).toBe('task_a');
  });

  it('filters by kind', () => {
    createCheckResult(ctx, { taskId: 'task_a', kind: 'lint', status: 'passed', checkName: 'A', success: true });
    createCheckResult(ctx, { taskId: 'task_a', kind: 'test', status: 'passed', checkName: 'B', success: true });
    const filtered = listCheckResults(ctx, { kind: 'lint' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.checkName).toBe('A');
  });

  it('filters by status', () => {
    createCheckResult(ctx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    createCheckResult(ctx, { taskId: 'task_a', status: 'failed', checkName: 'B', success: false });
    const filtered = listCheckResults(ctx, { status: 'failed' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.checkName).toBe('B');
  });

  it('returns empty array when no checks', () => {
    expect(listCheckResults(ctx)).toEqual([]);
  });
});

describe('policy denied', () => {
  it('denies check.create for a role without manage_runs', () => {
    const restrictedCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'conn:test', type: 'agent', roles: ['connector'] },
      policy: new RoleBasedPolicyEngine(),
    });
    expect(() =>
      createCheckResult(restrictedCtx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true }),
    ).toThrow(PolicyDeniedError);
  });

  it('allows check.create for builder role', () => {
    const builderCtx = createRuntimeContext({
      rootDir: testDir,
      actor: { id: 'builder:test', type: 'agent', roles: ['builder'] },
      policy: new RoleBasedPolicyEngine(),
    });
    const check = createCheckResult(builderCtx, { taskId: 'task_a', status: 'passed', checkName: 'A', success: true });
    expect(check.id).toMatch(/^check_/);
  });
});
