import {
  createRuntimeContext,
  createMeeting,
  listMeetings,
  getMeeting,
} from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export function runMeeting(args: ParsedArgs): void {
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
      case 'create': {
        const title = args.positional[0];
        if (!title) {
          console.log('Usage: mesa meeting create <title>');
          return;
        }
        const meeting = createMeeting(ctx, { title });
        outputResult(meeting, json, () => printSuccess(`Created meeting ${meeting.id}: ${meeting.title}`));
        return;
      }

      case 'list': {
        const meetings = listMeetings(ctx);
        outputResult(meetings, json, () => {
          if (meetings.length === 0) {
            console.log('No meetings found. Create one with: mesa meeting create <title>');
          } else {
            console.log(`\n  ${'ID'.padEnd(14)} ${'Status'.padEnd(12)} ${'Tasks'.padEnd(8)} ${'Title'}`);
            console.log(`  ${'─'.repeat(14)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(40)}`);
            for (const m of meetings) {
              console.log(`  ${m.id.padEnd(14)} ${m.status.padEnd(12)} ${String(m.tasks.length).padEnd(8)} ${m.title}`);
            }
            console.log(`\n  ${meetings.length} meeting(s)\n`);
          }
        });
        return;
      }

      case 'show': {
        const meetingId = args.positional[0];
        if (!meetingId) {
          console.log('Usage: mesa meeting show <meetingId>');
          return;
        }
        outputResult(getMeeting(ctx, meetingId), json);
        return;
      }

      default:
        console.log('Usage: mesa meeting <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  create <title>    Create a new meeting');
        console.log('  list              List all meetings');
        console.log('  show <id>         Show meeting details');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
