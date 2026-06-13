import {
  createRuntimeContext,
  getAvailableTransports,
} from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

export function runTransports(args: ParsedArgs): void {
  const ctx = createRuntimeContext({
    rootDir: process.cwd(),
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
  const json = !!args.flags['json'];

  try {
    const available = getAvailableTransports(ctx.transports);

    outputResult(available, json, () => {
      if (available.length === 0) {
        console.log('No transports available.');
      } else {
        console.log(`\n  ${'Name'.padEnd(20)} ${'Type'.padEnd(12)} ${'Version'.padEnd(8)} ${'Available'}`);
        console.log(`  ${'─'.repeat(20)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(9)}`);
        for (const t of available) {
          console.log(`  ${t.name.padEnd(20)} ${t.type.padEnd(12)} ${t.version.padEnd(8)} ${t.isAvailable() ? 'yes' : 'no'}`);
        }
        console.log(`\n  ${'─'.repeat(20)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(9)}`);
        console.log('');

        // Show capabilities for each transport
        for (const t of available) {
          console.log(`  ${t.name}:`);
          const caps = t.capabilities;
          const lines: string[] = [];
          if (caps.canCreateTasks) lines.push('create/read tasks');
          if (caps.canPostMessages) lines.push('post messages');
          if (caps.canAttachArtifacts) lines.push('attach artifacts');
          if (caps.canCreateMeetings) lines.push('create meetings');
          if (caps.canRegisterAgents) lines.push('register agents');
          if (caps.supportsPush) lines.push('push events');
          if (caps.supportsBidirectional) lines.push('bidirectional');
          console.log(`    ${lines.join(', ') || 'read-only'}`);
          console.log('');
        }
      }
    });
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
