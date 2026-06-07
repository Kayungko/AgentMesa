import { join } from 'node:path';
import { MesaAgentSchema } from '@agentmesa/protocol';
import type { MesaAgent } from '@agentmesa/protocol';
import { AgentNotFoundError } from '../errors.js';
import type { MesaRuntimeContext } from '../runtime/types.js';
import {
  appendRuntimeEvent,
  assertPolicy,
  listJsonFromStorage,
  readJsonFromStorage,
  writeJsonToStorage,
} from './runtime-service-utils.js';

export function registerAgent(ctx: MesaRuntimeContext, agent: MesaAgent): MesaAgent {
  assertPolicy(ctx, 'agent.register', `agent:${agent.id}`);
  const result = MesaAgentSchema.parse(agent);
  writeJsonToStorage(ctx, getAgentFilePath(ctx, agent.id), result);

  appendRuntimeEvent(ctx, {
    meetingId: 'workspace',
    type: 'agent_joined',
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
