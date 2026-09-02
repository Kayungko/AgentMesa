import { join } from 'node:path';
import { MesaAgentSchema } from '@agentmesa/protocol';
import type { MesaAgent } from '@agentmesa/protocol';
import { AgentNotFoundError, MesaError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

/**
 * Roles an actor may register ITSELF under via the MCP bootstrap path
 * (`selfRegisterAgent`). Derived from the capability tables: every role that
 * holds delete_task / archive_task / rebuild_projections / inspect_transports
 * / manage_workflows, plus the owner/admin meta-roles, is privileged.
 * NOTE: when the protocol role enum grows, new roles must be classified into
 * exactly one of these two sets — never default into SELF_REGISTRABLE.
 */
export const SELF_REGISTRABLE_ROLES: ReadonlySet<string> = new Set([
  'planner', 'builder', 'reviewer', 'tester', 'documenter', 'researcher',
  'custom', 'connector', 'ci',
]);

/** Privileged roles that only an owner/admin actor (or the operator CLI) may register. */
export const PRIVILEGED_REGISTRATION_ROLES: ReadonlySet<string> = new Set([
  'owner', 'admin', 'chair', 'maintainer', 'system',
]);

/**
 * Normalize an actor/agent id to its member ref by dropping the prefix
 * before the first colon (`agent:codex` → `codex`; bare `user` stays `user`).
 * Single source of truth — the MCP tools layer re-exports this.
 */
export function actorRefOf(actorId: string): string {
  const idx = actorId.indexOf(':');
  return idx >= 0 ? actorId.slice(idx + 1) : actorId;
}

export function registerAgent(ctx: MesaRuntimeContext, agent: MesaAgent): MesaAgent {
  assertPolicy(ctx, 'agent.register', `agent:${agent.id}`);
  return writeAgentRecord(ctx, agent);
}

/**
 * Bootstrap registration channel: an actor that connected WITHOUT a registry
 * entry (e.g. an unregistered HTTP session downgraded to read-only) may
 * register ITSELF under non-privileged roles. Structural checks replace the
 * policy assertion — the checks ARE the policy:
 *
 * - the target id must be the actor's own id (or its normalized ref);
 * - every requested role must be in {@link SELF_REGISTRABLE_ROLES};
 * - the entry must NOT already exist (unlike `registerAgent`, this channel
 *   never overwrites — a downgraded actor cannot rewrite someone else's
 *   registered entry by re-registering it).
 *
 * None of this expands what the actor could already reach: the id it
 * connected under was self-chosen anyway, and privileged roles are fenced off.
 */
export function selfRegisterAgent(ctx: MesaRuntimeContext, agent: MesaAgent): MesaAgent {
  if (actorRefOf(agent.id) !== actorRefOf(ctx.actor.id)) {
    throw new MesaError(
      'POLICY_DENIED',
      `self registration refused: agent id "${agent.id}" does not match the current actor "${ctx.actor.id}". ` +
        'Registering another agent requires an actor with the manage_agents capability (e.g. via "mesa agent add").',
    );
  }
  for (const role of agent.roles) {
    if (!SELF_REGISTRABLE_ROLES.has(role)) {
      throw new MesaError(
        'POLICY_DENIED',
        `self registration refused: role "${role}" is privileged. Self-registration allows: ${[...SELF_REGISTRABLE_ROLES].join(', ')}. ` +
          'Privileged roles must be granted by an operator (e.g. "mesa agent add").',
      );
    }
  }
  const existing = readJsonFromStorage<MesaAgent>(ctx, getAgentFilePath(ctx, agent.id));
  if (existing) {
    throw new MesaError(
      'POLICY_DENIED',
      `self registration refused: agent "${agent.id}" is already registered. ` +
        'Updating an existing registration requires the operator channel (e.g. "mesa agent add").',
    );
  }
  return writeAgentRecord(ctx, agent);
}

function writeAgentRecord(ctx: MesaRuntimeContext, agent: MesaAgent): MesaAgent {
  const result = MesaAgentSchema.parse(agent);
  writeJsonToStorage(ctx, getAgentFilePath(ctx, agent.id), result);

  appendRuntimeEvent(ctx, {
    meetingId: 'workspace',
    type: 'agent_registered',
    streamId: result.id,
    streamType: 'agent',
    data: { agent: result },
  });

  return result;
}

export function getAgent(ctx: MesaRuntimeContext, agentId: string): MesaAgent {
  const agent = readJsonFromStorage<MesaAgent>(
    ctx,
    getAgentFilePath(ctx, agentId)
  );
  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }
  return MesaAgentSchema.parse(agent);
}

export function listAgents(ctx: MesaRuntimeContext): MesaAgent[] {
  return listJsonFromStorage<MesaAgent>(ctx, ctx.paths.agentsDir)
    .map((a) => MesaAgentSchema.safeParse(a))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaAgent }).data);
}

function getAgentFilePath(ctx: MesaRuntimeContext, agentId: string): string {
  return join(ctx.paths.agentsDir, `${encodeURIComponent(agentId)}.json`);
}
