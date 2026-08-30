import {
  createRuntimeContext,
  explainTask,
  explainMeeting,
} from '@agentmesa/core';
import type {
  ExplainMeetingResult,
  ExplainTaskResult,
  MesaRuntimeContext,
  WhyBlocker,
  WhyEventRef,
  WhyStatusStep,
} from '@agentmesa/core';
import { TaskNotFoundError, MeetingNotFoundError } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printError, outputResult } from '../output.js';

function createCtx(): MesaRuntimeContext {
  return createRuntimeContext({
    rootDir: process.cwd(),
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });
}

function printUsage(): void {
  console.log('Usage:');
  console.log('  mesa why <id>               Auto-detect task or meeting and explain it');
  console.log('  mesa why task <taskId>       Explain why a task sits in its current status');
  console.log('  mesa why meeting <meetingId> Explain why a meeting sits in its current status');
  console.log('');
  console.log('Flags:');
  console.log('  --json    Full structured output (safe for local AI consumption)');
}

export function runWhy(args: ParsedArgs, ctxOverride?: MesaRuntimeContext): void {
  const ctx = ctxOverride ?? createCtx();
  const json = !!args.flags['json'];
  const targetId = args.positional[0];

  if (!targetId && (args.subcommand === 'task' || args.subcommand === 'meeting')) {
    printUsage();
    return;
  }

  try {
    switch (args.subcommand) {
      case 'task': {
        const result = explainTask(ctx, targetId!);
        outputResult(result, json, () => printTaskExplanation(result));
        return;
      }

      case 'meeting': {
        const result = explainMeeting(ctx, targetId!);
        outputResult(result, json, () => printMeetingExplanation(result));
        return;
      }

      default: {
        // Auto-detect: task first, then meeting.
        if (!targetId) {
          printUsage();
          return;
        }
        let taskResult: ExplainTaskResult | null = null;
        try {
          taskResult = explainTask(ctx, targetId);
        } catch (err) {
          if (!(err instanceof TaskNotFoundError)) throw err;
        }
        if (taskResult) {
          outputResult(taskResult, json, () => printTaskExplanation(taskResult));
          return;
        }
        const meetingResult = explainMeeting(ctx, targetId);
        outputResult(meetingResult, json, () => printMeetingExplanation(meetingResult));
        return;
      }
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Human-readable rendering
// ---------------------------------------------------------------------------

function printHeader(title: string, subtitle: string): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  console.log(`  ${subtitle}`);
  console.log('');
}

function printStatusChain(chain: WhyStatusStep[]): void {
  console.log('Status chain:');
  if (chain.length === 0) {
    console.log('  (no status transitions recorded)');
    console.log('');
    return;
  }
  for (const step of chain) {
    const transition = step.from === null ? `(created) ${step.to}` : `${step.from} -> ${step.to}`;
    console.log(`  ${step.at}  ${transition.padEnd(44)} by ${step.actor}`);
    console.log(`    cause (${step.cause.confidence}): ${step.cause.description}`);
  }
  console.log('');
}

function printTimeline(timeline: WhyEventRef[]): void {
  console.log('Timeline:');
  if (timeline.length === 0) {
    console.log('  (no events)');
    console.log('');
    return;
  }
  console.log(`  ${'At'.padEnd(26)} ${'Type'.padEnd(26)} ${'Actor'.padEnd(18)} Summary`);
  console.log(`  ${'─'.repeat(26)} ${'─'.repeat(26)} ${'─'.repeat(18)} ${'─'.repeat(40)}`);
  for (const entry of timeline) {
    console.log(
      `  ${entry.at.padEnd(26)} ${entry.type.padEnd(26)} ${entry.actor.padEnd(18)} ${entry.summary}`,
    );
  }
  console.log(`\n  ${timeline.length} event(s)\n`);
}

function printBlocker(blocker: WhyBlocker): void {
  console.log('Conclusion:');
  console.log(`  kind        : ${blocker.kind} (${blocker.confidence})`);
  console.log(`  summary     : ${blocker.summary}`);
  if (blocker.waitingOn) console.log(`  waiting on  : ${blocker.waitingOn}`);
  if (blocker.since) console.log(`  since       : ${blocker.since}`);
  if (blocker.lastActivityAt !== undefined && blocker.lastActivityAt !== null) {
    console.log(`  last activity: ${blocker.lastActivityAt}`);
  }
  if (blocker.errorSummary) console.log(`  error       : ${blocker.errorSummary}`);
  if (blocker.detail) console.log(`  detail      : ${blocker.detail}`);
  if (blocker.evidenceEventIds.length > 0) {
    console.log(`  evidence    : ${blocker.evidenceEventIds.join(', ')}`);
  }
  console.log('');
}

function printRuns(runs: ExplainTaskResult['relatedRuns']): void {
  if (runs.length === 0) return;
  console.log('Related runs:');
  for (const run of runs) {
    const parts = [
      run.runId,
      `status=${run.status}`,
      `agent=${run.agentId}`,
      run.action ? `action=${run.action}` : undefined,
      run.error ? `error=${run.error}` : undefined,
    ].filter((part): part is string => part !== undefined);
    console.log(`  ${parts.join('  ')}`);
  }
  console.log('');
}

function printArtifacts(artifacts: ExplainTaskResult['relatedArtifacts']): void {
  if (artifacts.length === 0) return;
  console.log('Related artifacts:');
  for (const artifact of artifacts) {
    const label = artifact.title ? `"${artifact.title}"` : '';
    console.log(`  ${artifact.artifactId}  ${artifact.kind.padEnd(22)} ${label} by ${artifact.createdBy}`);
  }
  console.log('');
}

function printTaskExplanation(result: ExplainTaskResult): void {
  const title = result.title ? `"${result.title}"` : '(title unknown)';
  printHeader(`Task Why: ${result.taskId}`, `Title: ${title}\n  Status: ${result.currentStatus}${result.deleted ? ' (record deleted)' : ''}${result.archived ? ' (archived)' : ''}`);
  printStatusChain(result.statusChain);
  printTimeline(result.timeline);
  printRuns(result.relatedRuns);
  printArtifacts(result.relatedArtifacts);
  printBlocker(result.blocker);
}

function printMeetingExplanation(result: ExplainMeetingResult): void {
  const title = result.title ? `"${result.title}"` : '(title unknown)';
  printHeader(`Meeting Why: ${result.meetingId}`, `Title: ${title}\n  Status: ${result.currentStatus}`);
  printStatusChain(result.statusChain);
  printTimeline(result.timeline);
  if (result.tasks.length > 0) {
    console.log('Tasks:');
    for (const task of result.tasks) {
      const taskTitle = task.title ? `"${task.title}"` : '';
      console.log(`  ${task.taskId}  ${task.status.padEnd(22)} ${taskTitle}`);
    }
    console.log('');
  }
  printRuns(result.relatedRuns);
  printArtifacts(result.relatedArtifacts);
  printBlocker(result.blocker);
}
