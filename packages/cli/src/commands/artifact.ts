import {
  createRuntimeContext,
  listArtifacts,
  getArtifact,
} from '@agentmesa/core';
import type { ArtifactKind } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

export function runArtifact(args: ParsedArgs): void {
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
      case 'list': {
        const taskId = args.positional[0] ?? (typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined);
        const kind = typeof args.flags['kind'] === 'string' ? (args.flags['kind'] as ArtifactKind) : undefined;
        const artifacts = listArtifacts(ctx, taskId, kind);
        outputResult(artifacts, json, () => {
          if (artifacts.length === 0) {
            console.log('No artifacts found.');
          } else {
            console.log(`\n  ${'ID'.padEnd(10)} ${'Kind'.padEnd(26)} ${'Task'.padEnd(10)} ${'Content'}`);
            console.log(`  ${'─'.repeat(10)} ${'─'.repeat(26)} ${'─'.repeat(10)} ${'─'.repeat(40)}`);
            for (const a of artifacts) {
              console.log(`  ${a.id.padEnd(10)} ${a.kind.padEnd(26)} ${(a.taskId ?? '-').padEnd(10)} ${a.content.slice(0, 40)}`);
            }
            console.log(`\n  ${artifacts.length} artifact(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const artifactId = args.positional[0];
        if (!artifactId) {
          console.log('Usage: mesa artifact show <artifactId>');
          return;
        }
        outputResult(getArtifact(ctx, artifactId), json);
        return;
      }

      default:
        console.log('Usage: mesa artifact <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  list [taskId]     List artifacts (optionally filtered)');
        console.log('  show <id>         Show artifact details');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
