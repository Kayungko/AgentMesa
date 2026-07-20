import {
  createRuntimeContext,
  RoleBasedPolicyEngine,
  PolicyDeniedError,
} from '@agentmesa/core';
import type { AgentRole, PermissionLevel } from '@agentmesa/protocol';
import type { MesaActor } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult, outputError } from '../output.js';

type PolicyRole = AgentRole | PermissionLevel;

const VALID_ROLES: readonly PolicyRole[] = [
  'owner', 'admin', 'builder', 'reviewer', 'connector', 'ci', 'system', 'read_only',
  'chair', 'planner', 'tester', 'documenter', 'maintainer', 'researcher', 'custom',
] as const;

function validateRole(input: string): PolicyRole {
  if ((VALID_ROLES as readonly string[]).includes(input)) {
    return input as PolicyRole;
  }
  throw new PolicyDeniedError(
    'policy.check',
    `role:${input}`,
    `Invalid role "${input}". Valid roles: ${VALID_ROLES.join(', ')}`,
  );
}

function parseRoles(raw: string): PolicyRole[] {
  return raw.split(',').map((r) => validateRole(r.trim()));
}

type PolicyMode = 'role-based' | 'current';

function resolveMode(args: ParsedArgs, defaultMode: PolicyMode): PolicyMode {
  const raw = args.flags['mode'];
  if (raw === 'role-based' || raw === 'current') return raw;
  if (raw) {
    throw new Error(`Invalid --mode "${raw}". Must be "role-based" or "current".`);
  }
  return defaultMode;
}

function buildActor(args: ParsedArgs, defaultRole: PolicyRole): MesaActor {
  const rolesRaw = args.flags['roles'];
  let roles: PolicyRole[];
  if (typeof rolesRaw === 'string') {
    roles = parseRoles(rolesRaw);
  } else {
    const single = args.flags['role'];
    const role = typeof single === 'string' ? validateRole(single) : defaultRole;
    roles = [role];
  }

  const actorId = args.flags['actor'];
  return {
    id: typeof actorId === 'string' ? actorId : 'cli:user',
    type: 'user',
    roles: roles as MesaActor['roles'],
  };
}

export function runPolicyCheck(args: ParsedArgs): void {
  const json = !!args.flags['json'];
  const action = args.positional[0];
  const resource = args.positional[1] ?? '*';

  if (!action) {
    outputError(new Error('Usage: mesa policy check <action> <resource> --actor <id> --role <role> [--mode role-based|current]'), json);
    process.exitCode = 1;
    return;
  }

  try {
    const mode = resolveMode(args, 'role-based');
    const actor = buildActor(args, 'builder');

    if (mode === 'role-based') {
      const engine = new RoleBasedPolicyEngine();
      const decision = engine.can(actor, action, resource);
      outputResult(
        {
          mode: 'role-based',
          action,
          resource,
          actor: actor.id,
          roles: actor.roles,
          allowed: decision.allowed,
          reason: decision.reason ?? null,
          requiresApproval: decision.requiresApproval ?? false,
        },
        json,
        () => printHumanCheck('role-based', action, resource, actor, decision.allowed, decision.reason, false),
      );
    } else {
      const ctx = createRuntimeContext({
        rootDir: process.cwd(),
        actor,
      });
      const decision = ctx.policy.can(ctx.actor, action, resource);
      const effectiveMode = ctx.config.policy?.mode ?? 'allow-all';
      outputResult(
        {
          mode: effectiveMode,
          action,
          resource,
          actor: ctx.actor.id,
          roles: ctx.actor.roles,
          allowed: decision.allowed,
          reason: decision.reason ?? null,
          requiresApproval: decision.requiresApproval ?? false,
        },
        json,
        () => printHumanCheck(effectiveMode, action, resource, actor, decision.allowed, decision.reason, decision.requiresApproval ?? false),
      );
    }
  } catch (err) {
    outputError(err, json);
    process.exitCode = 1;
  }
}

function printHumanCheck(
  mode: string,
  action: string,
  resource: string,
  actor: MesaActor,
  allowed: boolean,
  reason: string | undefined,
  requiresApproval: boolean,
): void {
  const status = allowed ? 'ALLOWED' : 'DENIED';
  console.log(`\n  Policy check: ${status}`);
  console.log(`    Mode    : ${mode}`);
  console.log(`    Action  : ${action}`);
  console.log(`    Resource: ${resource}`);
  console.log(`    Actor   : ${actor.id} (roles: ${(actor.roles as string[]).join(', ')})`);
  if (reason) console.log(`    Reason  : ${reason}`);
  if (requiresApproval) console.log(`    Note    : This action requires manual approval`);
  console.log('');
}

export function runPolicyInspect(args: ParsedArgs): void {
  const json = !!args.flags['json'];

  const knownActions = [
    'task.create', 'task.updateStatus', 'task.assign', 'task.archive', 'task.delete',
    'meeting.create', 'meeting.updateStatus', 'meeting.addTask', 'meeting.addAgent',
    'message.append', 'artifact.create', 'agent.register',
    'event.read', 'projection.read', 'projection.rebuild', 'transport.inspect',
    'run.create', 'run.updateStatus', 'run.read',
    'handoff.write', 'handoff.read',
    'check.create', 'check.read',
  ];

  const roles = VALID_ROLES;

  try {
    const mode = resolveMode(args, 'role-based');
    if (mode === 'role-based') {
      const engine = new RoleBasedPolicyEngine();
      const results = knownActions.map((action) => {
        const roleResults: Record<string, boolean> = {};
        for (const role of roles) {
          const actor = {
            id: `inspect:${role}`,
            type: 'system' as const,
            roles: [role] as unknown as MesaActor['roles'],
          };
          roleResults[role] = engine.can(actor, action, '*').allowed;
        }
        return { action, ...roleResults };
      });
      outputResult(
        { mode: 'role-based', actions: results, roles },
        json,
        () => printHumanMatrix('role-based', roles, results),
      );
    } else {
      const ctx = createRuntimeContext({
        rootDir: process.cwd(),
        actor: { id: 'cli:user', type: 'user', roles: ['owner'] },
      });
      const effectiveMode = ctx.config.policy?.mode ?? 'allow-all';
      const results = knownActions.map((action) => {
        const roleResults: Record<string, boolean> = {};
        for (const role of roles) {
          const actor = {
            id: `inspect:${role}`,
            type: 'system' as const,
            roles: [role] as unknown as MesaActor['roles'],
          };
          roleResults[role] = ctx.policy.can(actor, action, '*').allowed;
        }
        return { action, ...roleResults };
      });
      outputResult(
        { mode: effectiveMode, actions: results, roles },
        json,
        () => printHumanMatrix(effectiveMode, roles, results),
      );
    }
  } catch (err) {
    outputError(err, json);
    process.exitCode = 1;
  }
}

function printHumanMatrix(
  mode: string,
  roles: readonly string[],
  results: { action: string }[],
): void {
  console.log(`\n  Policy mode: ${mode}\n`);
  console.log(`  ${'Action'.padEnd(24)} ${roles.map((r) => r.slice(0, 5).padEnd(7)).join('')}`);
  console.log(`  ${'─'.repeat(24)} ${'─'.repeat(7 * roles.length)}`);
  for (const row of results) {
    const cells = roles.map((r) => {
      const ok = (row as Record<string, unknown>)[r] as boolean;
      return ok ? ' ✓    ' : ' ✗    ';
    }).join('');
    console.log(`  ${(row as { action: string }).action.padEnd(24)} ${cells}`);
  }
  console.log('');
}
