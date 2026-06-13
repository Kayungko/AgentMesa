import {
  createRuntimeContext,
  registerAgent,
  listAgentReadModels,
  getAgentReadModel,
} from '@agentmesa/core';
import type { AgentRole } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export function runAgent(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const ctx = createRuntimeContext({
    rootDir,
    actor: {
      id: 'user:local',
      type: 'user',
      roles: ['owner'],
    },
  });
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'add': {
        const id = args.positional[0];
        const name = args.positional[1];
        const rolesStr = args.positional[2];
        if (!id || !name) {
          console.log('Usage: mesa agent add <id> <name> [roles...]');
          console.log('  Roles: chair, planner, builder, reviewer, tester, documenter, maintainer');
          console.log('  Example: mesa agent add claude "Claude Code" builder planner');
          return;
        }
        const roles = rolesStr
          ? rolesStr.split(',').map((r) => r.trim()) as AgentRole[]
          : (['builder'] as AgentRole[]);

        const client = typeof args.flags['client'] === 'string' ? args.flags['client'] : id;
        const agent = registerAgent(ctx, { id, name, client, status: 'available', roles });
        outputResult(agent, json, () => printSuccess(`Registered agent: ${agent.id} (${agent.name})`));
        return;
      }

      case 'list': {
        const agents = listAgentReadModels(ctx);
        outputResult(agents, json, () => {
          if (agents.length === 0) {
            console.log('No agents registered. Add one with: mesa agent add <id> <name> [roles]');
          } else {
            console.log(`\n  ${'ID'.padEnd(20)} ${'Name'.padEnd(20)} ${'Client'.padEnd(16)} Roles`);
            console.log(`  ${'─'.repeat(20)} ${'─'.repeat(20)} ${'─'.repeat(16)} ${'─'.repeat(30)}`);
            for (const a of agents) {
              const roles = Array.isArray(a.roles) ? (a.roles as string[]).join(', ') : String(a.roles ?? '');
              console.log(`  ${(a.id as string).padEnd(20)} ${(a.name as string).padEnd(20)} ${(a.client as string).padEnd(16)} ${roles}`);
            }
            console.log(`\n  ${agents.length} agent(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const agentId = args.positional[0];
        if (!agentId) {
          console.log('Usage: mesa agent show <agentId>');
          return;
        }
        const agent = getAgentReadModel(ctx, agentId);
        if (!agent) {
          outputResult(null, json, () => console.log(`Agent "${agentId}" not found.`));
          return;
        }
        outputResult(agent, json);
        return;
      }

      default:
        console.log('Usage: mesa agent <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  add <id> <name> [roles]   Register an agent');
        console.log('  list                      List all agents');
        console.log('  show <id>                 Show agent details');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
