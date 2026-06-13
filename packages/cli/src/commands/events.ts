import {
  createRuntimeContext,
  listEvents,
  getTaskEvents,
  getMeetingEvents,
  getTaskProjection,
  getMeetingProjection,
} from '@agentmesa/core';
import type { MesaEvent } from '@agentmesa/protocol';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

function createCtx() {
  return createRuntimeContext({
    rootDir: process.cwd(),
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
}

export function runEvents(args: ParsedArgs): void {
  const ctx = createCtx();
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'list': {
        const meetingId = typeof args.flags['meeting'] === 'string' ? args.flags['meeting'] : undefined;
        const taskId = typeof args.flags['task'] === 'string' ? args.flags['task'] : undefined;
        const type = typeof args.flags['type'] === 'string' ? args.flags['type'] : undefined;
        const actor = typeof args.flags['actor'] === 'string' ? args.flags['actor'] : undefined;

        const events = listEvents(ctx, {
          meetingId,
          streamId: taskId,
          type: type as MesaEvent['type'] | undefined,
          actor,
        });

        outputResult(events, json, () => {
          if (events.length === 0) {
            console.log('No events found.');
          } else {
            console.log(`\n  ${'Seq'.padEnd(5)} ${'Type'.padEnd(26)} ${'Stream'.padEnd(14)} ${'Actor'.padEnd(20)} ${'Timestamp'}`);
            console.log(`  ${'─'.repeat(5)} ${'─'.repeat(26)} ${'─'.repeat(14)} ${'─'.repeat(20)} ${'─'.repeat(24)}`);
            for (const e of events) {
              console.log(`  ${String(e.sequence).padEnd(5)} ${e.type.padEnd(26)} ${e.streamId.padEnd(14)} ${e.actor.padEnd(20)} ${e.timestamp}`);
            }
            console.log(`\n  ${events.length} event(s)\n`);
          }
        });
        return;
      }

      default:
        console.log('Usage: mesa events <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  list [--meeting <id>] [--task <id>] [--type <type>] [--actor <id>]');
        console.log('    List events with optional filters');
        console.log('');
        console.log('Also available:');
        console.log('  mesa timeline <id>            Auto-detect task or meeting timeline');
        console.log('  mesa timeline task <id>       Show task event timeline + projection');
        console.log('  mesa timeline meeting <id>    Show meeting event timeline + projection');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

export function runTimeline(args: ParsedArgs): void {
  const ctx = createCtx();
  const json = !!args.flags['json'];
  const targetId = args.positional[0];

  if (!targetId) {
    console.log('Usage:');
    console.log('  mesa timeline <id>            Auto-detect task or meeting timeline');
    console.log('  mesa timeline task <taskId>   Show task event timeline + projection');
    console.log('  mesa timeline meeting <meetingId> Show meeting event timeline + projection');
    return;
  }

  try {
    switch (args.subcommand) {
      case 'task': {
        const events = getTaskEvents(ctx, targetId);
        const projection = getTaskProjection(ctx, targetId);
        outputResult(
          { streamType: 'task', streamId: targetId, inferredType: null, projection, events },
          json,
          () => {
            console.log(`\nTask Timeline: ${targetId}`);
            console.log(`${'─'.repeat(60)}`);
            if (projection) {
              console.log(`  Status: ${(projection as Record<string, unknown>).status ?? 'unknown'}`);
              console.log(`  Title:  ${(projection as Record<string, unknown>).title ?? 'unknown'}`);
            }
            if (events.length === 0 && !projection) {
              console.log(`  No events or projection found for "${targetId}".`);
            } else {
              console.log('');
              printEventTimeline(events);
            }
          }
        );
        return;
      }

      case 'meeting': {
        const events = getMeetingEvents(ctx, targetId);
        const projection = getMeetingProjection(ctx, targetId);
        outputResult(
          { streamType: 'meeting', streamId: targetId, inferredType: null, projection, events },
          json,
          () => {
            console.log(`\nMeeting Timeline: ${targetId}`);
            console.log(`${'─'.repeat(60)}`);
            if (projection) {
              const p = projection as Record<string, unknown>;
              console.log(`  Status: ${p.status ?? 'unknown'}`);
              console.log(`  Title:  ${p.title ?? 'unknown'}`);
              console.log(`  Tasks:  ${JSON.stringify(p.taskIds ?? p.tasks ?? [])}`);
            }
            if (events.length === 0 && !projection) {
              console.log(`  No events or projection found for "${targetId}".`);
            } else {
              console.log('');
              printEventTimeline(events);
            }
          }
        );
        return;
      }

      default: {
        // Auto-detect: try task first, then meeting
        const taskEvents = listEvents(ctx, { streamId: targetId, streamType: 'task' });
        const taskProjection = getTaskProjection(ctx, targetId);

        if (taskEvents.length > 0 || taskProjection) {
          outputResult(
            { streamType: 'task', streamId: targetId, inferredType: 'task', projection: taskProjection, events: taskEvents },
            json,
            () => {
              console.log(`\nTask Timeline: ${targetId}`);
              console.log(`${'─'.repeat(60)}`);
              if (taskProjection) {
                console.log(`  Status: ${(taskProjection as Record<string, unknown>).status ?? 'unknown'}`);
                console.log(`  Title:  ${(taskProjection as Record<string, unknown>).title ?? 'unknown'}`);
              }
              if (taskEvents.length === 0 && !taskProjection) {
                console.log(`  No events or projection found for "${targetId}".`);
              } else {
                console.log('');
                printEventTimeline(taskEvents);
              }
            }
          );
          return;
        }

        const meetingEvents = getMeetingEvents(ctx, targetId);
        const meetingProjection = getMeetingProjection(ctx, targetId);

        if (meetingEvents.length > 0 || meetingProjection) {
          outputResult(
            { streamType: 'meeting', streamId: targetId, inferredType: 'meeting', projection: meetingProjection, events: meetingEvents },
            json,
            () => {
              console.log(`\nMeeting Timeline: ${targetId}`);
              console.log(`${'─'.repeat(60)}`);
              if (meetingProjection) {
                const p = meetingProjection as Record<string, unknown>;
                console.log(`  Status: ${p.status ?? 'unknown'}`);
                console.log(`  Title:  ${p.title ?? 'unknown'}`);
                console.log(`  Tasks:  ${JSON.stringify(p.taskIds ?? p.tasks ?? [])}`);
              }
              if (meetingEvents.length === 0 && !meetingProjection) {
                console.log(`  No events or projection found for "${targetId}".`);
              } else {
                console.log('');
                printEventTimeline(meetingEvents);
              }
            }
          );
          return;
        }

        // Not found
        outputResult(
          { streamType: 'unknown', streamId: targetId, inferredType: 'none', projection: null, events: [] },
          json,
          () => {
            console.log(`No task or meeting found for "${targetId}".`);
          }
        );
        return;
      }
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

function printEventTimeline(events: MesaEvent[]): void {
  if (events.length === 0) {
    console.log('  (no events)');
    return;
  }
  console.log(`  ${'Seq'.padEnd(5)} ${'Type'.padEnd(26)} ${'Actor'.padEnd(20)} ${'Timestamp'}`);
  console.log(`  ${'─'.repeat(5)} ${'─'.repeat(26)} ${'─'.repeat(20)} ${'─'.repeat(24)}`);
  for (const e of events) {
    console.log(`  ${String(e.sequence).padEnd(5)} ${e.type.padEnd(26)} ${e.actor.padEnd(20)} ${e.timestamp}`);
  }
  console.log(`\n  ${events.length} event(s)\n`);
}
