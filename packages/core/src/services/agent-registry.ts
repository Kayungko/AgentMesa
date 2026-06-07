import { join } from 'node:path';
import { MesaAgentSchema } from '@agentmesa/protocol';
import type { MesaAgent } from '@agentmesa/protocol';
import type { MesaWorkspacePaths } from '../workspace.js';
import { readJson, writeJson, listJson } from '../storage.js';
import { AgentNotFoundError } from '../errors.js';

export function registerAgent(paths: MesaWorkspacePaths, agent: MesaAgent): MesaAgent {
  const result = MesaAgentSchema.parse(agent);
  writeJson(join(paths.agentsDir, `${agent.id}.json`), result);
  return result;
}

export function getAgent(paths: MesaWorkspacePaths, agentId: string): MesaAgent {
  const agent = readJson<MesaAgent>(join(paths.agentsDir, `${agentId}.json`));
  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }
  return MesaAgentSchema.parse(agent);
}

export function listAgents(paths: MesaWorkspacePaths): MesaAgent[] {
  return listJson<MesaAgent>(paths.agentsDir)
    .map((a) => MesaAgentSchema.safeParse(a))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: MesaAgent }).data);
}
