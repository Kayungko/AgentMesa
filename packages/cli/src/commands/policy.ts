import {
  createRuntimeContext,
} from '@agentmesa/core';
import type { MesaActor } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

export function runPolicyCheck(args: ParsedArgs): void {
  const json = !!args.flags['json'];
  const action = args.positional[0];
  const resource = args.positional[1] ?? '*';
  const actorId = args.flags['actor'] ?? 'cli:user';
  const role = args.flags['role'] ?? 'builder';

  if (!action) {
    printError(new Error('Usage: mesa policy check <action> <resource> --actor <id> --role <role>'));
    process.exitCode = 1;
    return;
  }

  const ctx = createRuntimeContext({
    rootDir: process.cwd(),
    actor: {
      id: typeof actorId === 'string' ? actorId : 'cli:user',
      type: 'user',
      roles: [(typeof role === 'string' ? role : 'builder') as 'builder'],
    },
  });

  try {
    const decision = ctx.policy.can(ctx.actor, action, resource);
    outputResult(
      {
        action,
        resource,
        actor: ctx.actor.id,
        roles: ctx.actor.roles,
        allowed: decision.allowed,
        reason: decision.reason ?? null,
        requiresApproval: decision.requiresApproval ?? false,
      },
      json,
      () => {
        const status = decision.allowed ? 'ALLOWED' : 'DENIED';
        console.log(`\n  Policy check: ${status}`);
        console.log(`    Action  : ${action}`);
        console.log(`    Resource: ${resource}`);
        console.log(`    Actor   : ${ctx.actor.id} (roles: ${ctx.actor.roles.join(', ')})`);
        if (decision.reason) console.log(`    Reason  : ${decision.reason}`);
        if (decision.requiresApproval) console.log(`    Note    : This action requires manual approval`);
        console.log('');
      },
    );
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

export function runPolicyInspect(args: ParsedArgs): void {
  const json = !!args.flags['json'];

  const ctx = createRuntimeContext({
    rootDir: process.cwd(),
    actor: { id: 'cli:user', type: 'user', roles: ['owner'] },
  });

  // Collect all known actions from the engine by probing common actions
  const knownActions = [
    'task.create', 'task.updateStatus', 'task.assign', 'task.archive', 'task.delete',
    'meeting.create', 'meeting.updateStatus', 'meeting.addTask', 'meeting.addAgent',
    'message.append', 'artifact.create', 'agent.register',
    'event.read', 'projection.read', 'projection.rebuild', 'transport.inspect',
  ];

  const roles = ['owner', 'admin', 'builder', 'reviewer', 'connector', 'ci', 'system'] as const;

  const results = knownActions.map((action) => {
    const roleResults: Record<string, boolean> = {};
    for (const role of roles) {
      const actor = { id: `inspect:${role}`, type: 'system' as const, roles: [role] as unknown as MesaActor['roles'] };
      roleResults[role] = ctx.policy.can(actor, action, '*').allowed;
    }
    return { action, ...roleResults };
  });

  try {
    outputResult(
      {
        mode: ctx.config.policy?.mode ?? 'allow-all',
        actions: results,
        roles,
      },
      json,
      () => {
        console.log(`\n  Policy mode: ${ctx.config.policy?.mode ?? 'allow-all'}\n`);
        console.log(`  ${'Action'.padEnd(24)} ${roles.map((r) => r.slice(0, 5).padEnd(7)).join('')}`);
        console.log(`  ${'─'.repeat(24)} ${'─'.repeat(7 * roles.length)}`);
        for (const row of results) {
          const cells = roles.map((r) => {
            const ok = (row as Record<string, unknown>)[r] as boolean;
            return ok ? ' ✓    ' : ' ✗    ';
          }).join('');
          console.log(`  ${row.action.padEnd(24)} ${cells}`);
        }
        console.log('');
      },
    );
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
