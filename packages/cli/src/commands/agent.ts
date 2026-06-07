import {
  createWorkspacePaths,
  registerAgent,
  listAgents,
} from '@agentmesa/core';
import type { AgentRole } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, formatOutput } from '../output.js';

export function runAgent(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const paths = createWorkspacePaths(rootDir);
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
        const agent = registerAgent(paths, { id, name, client, roles });
        printSuccess(`Registered agent: ${agent.id} (${agent.name})`);
        if (json) formatOutput(agent, true);
        return;
      }

      case 'list': {
        const agents = listAgents(paths);
        if (json) {
          formatOutput(agents, true);
        } else {
          if (agents.length === 0) {
            console.log('No agents registered. Add one with: mesa agent add <id> <name> [roles]');
          } else {
            console.log(`\n  ${'ID'.padEnd(20)} ${'Name'.padEnd(20)} ${'Client'.padEnd(16)} Roles`);
            console.log(`  ${'─'.repeat(20)} ${'─'.repeat(20)} ${'─'.repeat(16)} ${'─'.repeat(30)}`);
            for (const a of agents) {
              console.log(`  ${a.id.padEnd(20)} ${a.name.padEnd(20)} ${a.client.padEnd(16)} ${a.roles.join(', ')}`);
            }
            console.log(`\n  ${agents.length} agent(s)\n`);
          }
        }
        return;
      }

      default:
        console.log('Usage: mesa agent <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  add <id> <name> [roles]   Register an agent');
        console.log('  list                      List all agents');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
