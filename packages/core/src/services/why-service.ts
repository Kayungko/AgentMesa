/**
 * Causal-chain explanation service ("mesa why").
 *
 * Rebuilds the status-transition chain of a task or meeting from the event
 * log and answers the debugging question agents actually have:
 * "why is this entity stuck in its current state?"
 *
 * Design rules:
 * - Read-only: this service never writes events or entity files.
 * - Conservative: when the log does not contain evidence for a conclusion,
 *   the blocker is reported as `unknown` — causes are never invented.
 * - Causality from preceding events is temporal correlation, so it is always
 *   reported with confidence `inferred`, never `evidenced`.
 */

import type {
  MesaAgentRun,
  MesaArtifact,
  MesaCheckResult,
  MesaEvent,
  MesaMeeting,
  MesaTask,
} from '@agentmesa/protocol';
import type { MesaRuntimeContext } from '../runtime/types.js';
import { MeetingNotFoundError, TaskNotFoundError } from '../errors.js';
import { listEvents } from './event-service.js';
import { getTask, listTasks } from './task-service.js';
import { getMeeting } from './meeting-service.js';
import { listAgentRuns } from './agent-run-service.js';
import { listCheckResults } from './check-result-service.js';
import { listArtifacts } from './artifact-service.js';
import { assertPolicy } from './runtime-service-utils.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** How much evidence backs a conclusion. */
export type WhyConfidence = 'evidenced' | 'inferred' | 'unknown';

/** A single event referenced as evidence. */
export interface WhyEventRef {
  eventId: string;
  type: MesaEvent['type'];
  at: string;
  actor: string;
  streamType: string;
  streamId: string;
  summary: string;
  /** Present when the event itself changed entity status. */
  statusTransition: { from: string | null; to: string } | null;
}

/** Why one status transition happened (reconstructed from the log). */
export interface WhyCause {
  description: string;
  confidence: WhyConfidence;
  triggerEventIds: string[];
}

/** One step of the reconstructed status chain. */
export interface WhyStatusStep {
  from: string | null;
  to: string;
  at: string;
  actor: string;
  eventId: string;
  cause: WhyCause;
}

/** Current blocking-point classification. */
export type WhyBlockerKind =
  | 'waiting_review'
  | 'waiting_user_decision'
  | 'waiting_workflow_approval'
  | 'needs_fix'
  | 'stalled'
  | 'failed'
  | 'blocked'
  | 'active'
  | 'not_started'
  | 'awaiting_completion'
  | 'paused'
  | 'terminal'
  | 'archived'
  | 'deleted'
  | 'unknown';

/** The "why is it stuck here" conclusion. */
export interface WhyBlocker {
  kind: WhyBlockerKind;
  confidence: WhyConfidence;
  summary: string;
  waitingOn?: string;
  since?: string;
  lastActivityAt?: string | null;
  errorSummary?: string;
  detail?: string;
  evidenceEventIds: string[];
}

/** Agent run reference attached to an explanation. */
export interface WhyRunRef {
  runId: string;
  agentId: string;
  action?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  producedArtifactIds: string[];
}

/** Artifact reference attached to an explanation. */
export interface WhyArtifactRef {
  artifactId: string;
  kind: string;
  title?: string;
  createdBy: string;
  createdAt?: string;
}

/** Task snapshot inside a meeting explanation. */
export interface WhyTaskSnapshot {
  taskId: string;
  title?: string;
  status: string;
}

export interface ExplainTaskResult {
  entityType: 'task';
  taskId: string;
  title?: string;
  meetingId?: string;
  currentStatus: string;
  archived: boolean;
  deleted: boolean;
  statusChain: WhyStatusStep[];
  timeline: WhyEventRef[];
  blocker: WhyBlocker;
  relatedRuns: WhyRunRef[];
  relatedArtifacts: WhyArtifactRef[];
  lastActivityAt: string | null;
}

export interface ExplainMeetingResult {
  entityType: 'meeting';
  meetingId: string;
  title?: string;
  currentStatus: string;
  statusChain: WhyStatusStep[];
  timeline: WhyEventRef[];
  blocker: WhyBlocker;
  tasks: WhyTaskSnapshot[];
  relatedRuns: WhyRunRef[];
  relatedArtifacts: WhyArtifactRef[];
  lastActivityAt: string | null;
}

// ---------------------------------------------------------------------------
// Small extraction helpers (payloads are z.unknown records at read time)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Extract the taskId an event is about, if any (across all stream shapes). */
function extractTaskId(event: MesaEvent): string | undefined {
  const data = asRecord(event.data) ?? {};
  return (
    str(data.taskId) ??
    str(asRecord(data.task)?.id) ??
    str(asRecord(data.run)?.taskId) ??
    str(asRecord(data.check)?.taskId) ??
    str(asRecord(data.message)?.taskId) ??
    str(asRecord(data.artifact)?.taskId)
  );
}

/** All events that belong to a task's causal history (any stream shape). */
function eventsRelatedToTask(events: MesaEvent[], taskId: string): MesaEvent[] {
  return events.filter((event) => {
    // Only the task's own stream counts — other entities (meetings, runs…)
    // may coincidentally share an id-shaped streamId.
    if (event.streamType === 'task' && event.streamId === taskId) return true;
    return extractTaskId(event) === taskId;
  });
}

const CAUSAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message_sent',
  'agent_run_created',
  'agent_run_status_changed',
  'agent_run_completed',
  'agent_run_failed',
  'agent_run_cancelled',
  'check_completed',
  'workflow_waiting_approval',
  'workflow_approved',
  'workflow_rejected',
  'decision_made',
  'task_assigned',
  'meeting_agent_added',
  'meeting_agent_removed',
  'meeting_task_added',
  'artifact_created',
]);

/**
 * Message types that are auto-generated side effects of the transitions they
 * follow (task_created / status_changed notifications written by the services).
 * They are excluded from causal candidates: they never *cause* a transition.
 */
const NON_CAUSAL_MESSAGE_TYPES: ReadonlySet<string> = new Set(['task_created', 'status_changed']);

function isCausalEvent(event: MesaEvent): boolean {
  if (!CAUSAL_EVENT_TYPES.has(event.type)) return false;
  if (event.type === 'message_sent') {
    const messageType = str(asRecord(asRecord(event.data)?.message)?.type);
    return messageType !== undefined && !NON_CAUSAL_MESSAGE_TYPES.has(messageType);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event summarization
// ---------------------------------------------------------------------------

function summarizeEvent(event: MesaEvent): string {
  const data = asRecord(event.data) ?? {};
  switch (event.type) {
    case 'task_created': {
      const task = asRecord(data.task);
      return `Task created: "${str(task?.title) ?? event.streamId}"`;
    }
    case 'task_status_changed':
      return `Status: ${str(data.oldStatus) ?? '?'} -> ${str(data.newStatus) ?? '?'}`;
    case 'task_assigned': {
      const reviewer = str(data.reviewer);
      return `Assigned to ${str(data.assignedTo) ?? '?'}${reviewer ? ` (reviewer: ${reviewer})` : ''}`;
    }
    case 'task_deleted':
      return 'Task deleted';
    case 'task_archived':
      return 'Task archived';
    case 'meeting_created': {
      const meeting = asRecord(data.meeting);
      return `Meeting created: "${str(meeting?.title) ?? event.streamId}"`;
    }
    case 'meeting_status_changed':
      return `Meeting status: ${str(data.oldStatus) ?? '?'} -> ${str(data.newStatus) ?? '?'}`;
    case 'meeting_task_added':
      return `Task added to meeting: ${str(data.taskId) ?? '?'}`;
    case 'meeting_agent_added':
      return `Agent joined meeting: ${str(data.agentId) ?? '?'}`;
    case 'meeting_agent_removed':
      return `Agent left meeting: ${str(data.agentId) ?? '?'}`;
    case 'agent_registered':
      return `Agent registered: ${str(data.name) ?? event.streamId}`;
    case 'agent_joined':
      return 'Agent joined';
    case 'agent_left':
      return 'Agent left';
    case 'message_sent': {
      const message = asRecord(data.message);
      const from = str(message?.from) ?? '?';
      const to = str(message?.to);
      const type = str(message?.type) ?? 'message';
      const summary = str(message?.summary);
      return `Message(${type}) ${from}${to ? ` -> ${to}` : ''}${summary ? `: ${truncate(summary, 100)}` : ''}`;
    }
    case 'artifact_created': {
      const artifact = asRecord(data.artifact);
      const label = str(artifact?.title) ?? str(artifact?.id) ?? event.streamId;
      return `Artifact(${str(artifact?.kind) ?? '?'}) created: ${truncate(label, 80)}`;
    }
    case 'decision_made': {
      const decidedBy = str(data.decidedBy) ?? '?';
      const selected = str(data.selectedOption);
      return `Decision by ${decidedBy}${selected ? `: ${truncate(selected, 80)}` : ''}`;
    }
    case 'agent_run_created': {
      const run = asRecord(data.run);
      return `Run created (${str(run?.action) ?? '?'}) by agent ${str(run?.agentId) ?? '?'}`;
    }
    case 'agent_run_status_changed':
    case 'agent_run_completed':
    case 'agent_run_failed':
    case 'agent_run_cancelled': {
      const run = asRecord(data.run);
      const verb =
        event.type === 'agent_run_completed'
          ? 'completed'
          : event.type === 'agent_run_failed'
            ? 'failed'
            : event.type === 'agent_run_cancelled'
              ? 'cancelled'
              : `status ${str(data.newStatus) ?? '?'}`;
      const error = str(run?.error);
      return `Run ${event.streamId} ${verb}${error ? `: ${truncate(error, 120)}` : ''}`;
    }
    case 'agent_run_progress': {
      const stage = str(data.stage);
      const message = str(data.message);
      return `Run progress${stage ? ` [${stage}]` : ''}${message ? `: ${truncate(message, 100)}` : ''}`;
    }
    case 'workflow_waiting_approval': {
      const workflow = str(data.workflowId) ?? event.streamId;
      const step = str(data.stepId);
      const description = str(data.description);
      return `Workflow ${workflow} waiting approval${step ? ` (step ${step})` : ''}${description ? `: ${truncate(description, 100)}` : ''}`;
    }
    case 'workflow_approved': {
      const workflow = str(data.workflowId) ?? event.streamId;
      return `Workflow ${workflow} approved`;
    }
    case 'workflow_rejected': {
      const workflow = str(data.workflowId) ?? event.streamId;
      return `Workflow ${workflow} rejected`;
    }
    case 'check_completed': {
      const check = asRecord(data.check);
      return `Check ${str(check?.checkName) ?? event.streamId}: ${str(check?.status) ?? '?'}`;
    }
    case 'thread_created':
      return 'Thread created';
    case 'thread_resolved':
      return 'Thread resolved';
    case 'meeting_imported':
      return `Meeting imported from ${str(data.source) ?? 'external'} (${str(data.messageCount) ?? '?'} messages)`;
    default:
      return event.type;
  }
}

function toTimelineEntry(event: MesaEvent): WhyEventRef {
  const data = asRecord(event.data) ?? {};
  const isTaskStatus = event.type === 'task_status_changed';
  const isMeetingStatus = event.type === 'meeting_status_changed';
  return {
    eventId: event.id,
    type: event.type,
    at: event.timestamp,
    actor: event.actor,
    streamType: event.streamType,
    streamId: event.streamId,
    summary: summarizeEvent(event),
    statusTransition:
      isTaskStatus || isMeetingStatus
        ? {
            from: str(data.oldStatus) ?? null,
            to: str(data.newStatus) ?? '?',
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Status chain reconstruction
// ---------------------------------------------------------------------------

function describeCause(window: MesaEvent[]): WhyCause {
  if (window.length === 0) {
    return {
      description: 'no trigger events recorded between the previous transition and this one',
      confidence: 'unknown',
      triggerEventIds: [],
    };
  }
  const described = window.slice(-3);
  return {
    description: described.map(summarizeEvent).join('; '),
    confidence: 'inferred',
    triggerEventIds: window.map((event) => event.id),
  };
}

interface StatusChainInput {
  events: MesaEvent[];
  createdEventType: 'task_created' | 'meeting_created';
  changedEventType: 'task_status_changed' | 'meeting_status_changed';
  /** Status recorded by the creation event (fallback used if absent). */
  fallbackInitialStatus: string;
}

function buildStatusChain(input: StatusChainInput): WhyStatusStep[] {
  const { events, createdEventType, changedEventType, fallbackInitialStatus } = input;
  const steps: WhyStatusStep[] = [];

  const creationIndex = events.findIndex((event) => event.type === createdEventType);
  if (creationIndex !== -1) {
    const creation = events[creationIndex]!;
    const entity = asRecord(creation.data?.[createdEventType === 'task_created' ? 'task' : 'meeting']);
    steps.push({
      from: null,
      to: str(entity?.status) ?? fallbackInitialStatus,
      at: creation.timestamp,
      actor: creation.actor,
      eventId: creation.id,
      cause: {
        description: `${createdEventType === 'task_created' ? 'task' : 'meeting'} created by ${creation.actor}`,
        confidence: 'evidenced',
        triggerEventIds: [],
      },
    });
  }

  let previousIndex = creationIndex;
  let previousStatus = steps.at(-1)?.to ?? null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type !== changedEventType) continue;
    const newStatus = str(asRecord(event.data)?.newStatus);
    if (!newStatus) continue;
    const window = events
      .slice(Math.max(previousIndex + 1, 0), i)
      .filter(isCausalEvent);
    steps.push({
      from: previousStatus,
      to: newStatus,
      at: event.timestamp,
      actor: event.actor,
      eventId: event.id,
      cause: describeCause(window),
    });
    previousIndex = i;
    previousStatus = newStatus;
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Blocker analysis — task
// ---------------------------------------------------------------------------

function lastEvent(events: MesaEvent[], predicate: (event: MesaEvent) => boolean): MesaEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (predicate(event)) return event;
  }
  return undefined;
}

function messageOfType(events: MesaEvent[], messageType: string): MesaEvent | undefined {
  return lastEvent(events, (event) => {
    if (event.type !== 'message_sent') return false;
    return str(asRecord(asRecord(event.data)?.message)?.type) === messageType;
  });
}

/**
 * Events that were appended after the event that entered the current status.
 * Ordering is by log position (append order), not wall-clock timestamps —
 * ISO millisecond timestamps can tie within the same transition burst.
 */
function indexOfEvent(events: MesaEvent[], event: MesaEvent | undefined): number {
  if (!event) return -1;
  return events.findIndex((candidate) => candidate.id === event.id);
}

function failedRunError(runs: MesaAgentRun[]): string | undefined {
  const failed = runs
    .filter((run) => run.status === 'failed')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const run = failed[0];
  return run?.error ? truncate(run.error, 200) : undefined;
}

function failedCheckError(checks: MesaCheckResult[]): string | undefined {
  const failed = checks
    .filter((check) => check.status === 'failed' || check.status === 'error')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const check = failed[0];
  if (!check) return undefined;
  const source = check.summary ?? check.stderr ?? check.detail;
  return source ? `${check.checkName}: ${truncate(source, 200)}` : check.checkName;
}

function latestRunEventId(events: MesaEvent[], runId: string): string | undefined {
  const event = lastEvent(
    events,
    (event) => event.streamType === 'agent_run' && str(asRecord(asRecord(event.data)?.run)?.id) === runId,
  );
  return event?.id;
}

function analyzeTaskBlocker(
  task: MesaTask | null,
  events: MesaEvent[],
  runs: MesaAgentRun[],
  checks: MesaCheckResult[],
  statusChain: WhyStatusStep[],
  lastActivityAt: string | null,
): WhyBlocker {
  // Task record removed from disk.
  if (!task) {
    const deletion = lastEvent(events, (event) => event.type === 'task_deleted');
    if (deletion) {
      return {
        kind: 'deleted',
        confidence: 'evidenced',
        summary: `Task deleted by ${deletion.actor} at ${deletion.timestamp}`,
        since: deletion.timestamp,
        lastActivityAt,
        evidenceEventIds: [deletion.id],
      };
    }
    return {
      kind: 'unknown',
      confidence: 'unknown',
      summary: `Task record not found, but ${events.length} related event(s) exist in the log`,
      lastActivityAt,
      evidenceEventIds: events.slice(-5).map((event) => event.id),
    };
  }

  if (task.archived) {
    const archival = lastEvent(events, (event) => event.type === 'task_archived');
    return {
      kind: 'archived',
      confidence: archival ? 'evidenced' : 'inferred',
      summary: `Task archived${archival ? ` by ${archival.actor} at ${archival.timestamp}` : ' (no task_archived event found)'}`,
      since: archival?.timestamp ?? task.updatedAt,
      lastActivityAt,
      evidenceEventIds: archival ? [archival.id] : [],
    };
  }

  const status = task.status;
  const lastStep = statusChain.at(-1);
  const statusEventId = lastStep && lastStep.to === status ? lastStep.eventId : undefined;
  const since = statusEventId ? lastStep!.at : task.updatedAt;
  const baseEvidence = statusEventId ? [statusEventId] : [];
  const enteredIndex = statusEventId
    ? events.findIndex((event) => event.id === statusEventId)
    : -1;
  const afterEntering = enteredIndex >= 0 ? events.slice(enteredIndex + 1) : [];
  const assignee = task.assignedTo ?? task.assignedBuilder;
  const reviewer = task.reviewer ?? task.assignedReviewer;

  switch (status) {
    case 'ready_for_review':
    case 'in_review':
    case 'reviewing': {
      const request = messageOfType(events, 'review_request');
      const requestMessage = asRecord(asRecord(request?.data)?.message);
      const waitingOn = reviewer ?? str(requestMessage?.to);
      const staleResult = messageOfType(afterEntering, 'review_result');
      const evidence = [...baseEvidence, ...(request ? [request.id] : [])];
      return {
        kind: 'waiting_review',
        confidence: staleResult ? 'inferred' : waitingOn || request ? 'evidenced' : 'inferred',
        summary: `Waiting for review${waitingOn ? ` from ${waitingOn}` : ''} (status: ${status})`,
        waitingOn,
        since,
        lastActivityAt,
        detail: staleResult
          ? 'a review_result message was recorded after entering this status, but the status has not advanced — the state may be stale'
          : request
            ? `review requested at ${request.timestamp} by ${request.actor}`
            : 'no review_request message found in the log',
        evidenceEventIds: evidence,
      };
    }

    case 'needs_user_decision': {
      const waiting = lastEvent(
        events,
        (event) => event.type === 'workflow_waiting_approval' && extractTaskId(event) === task.id,
      );
      if (waiting) {
        const workflowId = str(asRecord(waiting.data)?.workflowId) ?? waiting.streamId;
        const decided = lastEvent(
          events,
          (event) =>
            (event.type === 'workflow_approved' || event.type === 'workflow_rejected') &&
            str(asRecord(event.data)?.workflowId) === workflowId,
        );
        const decidedAfter = indexOfEvent(events, decided) > indexOfEvent(events, waiting);
        return {
          kind: 'waiting_workflow_approval',
          confidence: decidedAfter ? 'inferred' : 'evidenced',
          summary: `Waiting for user approval of workflow ${workflowId}`,
          waitingOn: 'user',
          since,
          lastActivityAt,
          detail: decidedAfter
            ? `workflow decision recorded at ${decided!.timestamp}, but the task status has not advanced — the state may be stale`
            : summarizeEvent(waiting),
          evidenceEventIds: [...baseEvidence, waiting.id],
        };
      }
      const decision = lastEvent(
        events,
        (event) => event.type === 'decision_made' && extractTaskId(event) === task.id,
      );
      const decisionAfter = enteredIndex >= 0 && indexOfEvent(events, decision) > enteredIndex;
      return {
        kind: 'waiting_user_decision',
        confidence: 'evidenced',
        summary: 'Waiting for a user decision',
        waitingOn: 'user',
        since,
        lastActivityAt,
        detail: decision && decisionAfter
          ? `a decision was recorded at ${decision.timestamp}, but the task status has not advanced — the state may be stale`
          : 'no decision_made event recorded yet',
        evidenceEventIds: baseEvidence,
      };
    }

    case 'needs_fix':
    case 'changes_requested': {
      const result = messageOfType(events, 'review_result');
      const evidence = [...baseEvidence, ...(result ? [result.id] : [])];
      return {
        kind: 'needs_fix',
        confidence: result ? 'evidenced' : 'inferred',
        summary: `Waiting on ${assignee ?? 'the assignee'} to apply fixes (status: ${status})`,
        waitingOn: assignee,
        since,
        lastActivityAt,
        detail: result
          ? `latest review_result at ${result.timestamp}: ${summarizeEvent(result)}`
          : 'no review_result message found in the log',
        evidenceEventIds: evidence,
      };
    }

    case 'failed': {
      const errorSummary = failedRunError(runs) ?? failedCheckError(checks);
      const failedRun = runs.find((run) => run.status === 'failed');
      const evidence = [...baseEvidence];
      if (failedRun) {
        const runEventId = latestRunEventId(events, failedRun.id);
        if (runEventId) evidence.push(runEventId);
      }
      return {
        kind: 'failed',
        confidence: errorSummary ? 'evidenced' : 'inferred',
        summary: `Task failed${errorSummary ? '' : ' — cause not recorded in the log'}`,
        since,
        lastActivityAt,
        errorSummary,
        evidenceEventIds: evidence,
      };
    }

    case 'blocked': {
      const errorSummary = failedRunError(runs) ?? failedCheckError(checks);
      return {
        kind: 'blocked',
        confidence: errorSummary ? 'evidenced' : 'inferred',
        summary: `Task is blocked${errorSummary ? '' : ' — blocking cause not recorded in the log'}`,
        since,
        lastActivityAt,
        errorSummary,
        evidenceEventIds: baseEvidence,
      };
    }

    case 'in_progress': {
      const activeRuns = runs.filter((run) => run.status === 'pending' || run.status === 'running');
      const active = activeRuns[0];
      if (active) {
        const runEventId = latestRunEventId(events, active.id);
        return {
          kind: 'active',
          confidence: 'evidenced',
          summary: `Agent run ${active.id} is ${active.status} (agent ${active.agentId})`,
          waitingOn: active.agentId,
          since,
          lastActivityAt,
          detail: `run started at ${active.startedAt}`,
          evidenceEventIds: runEventId ? [...baseEvidence, runEventId] : baseEvidence,
        };
      }
      return {
        kind: 'stalled',
        confidence: 'inferred',
        summary: `in_progress with no active agent run; last activity at ${lastActivityAt ?? 'unknown'}`,
        since,
        lastActivityAt,
        detail: 'no pending or running agent run exists for this task — it may be stalled or driven by an external process',
        evidenceEventIds: baseEvidence,
      };
    }

    case 'todo':
    case 'backlog':
    case 'ready': {
      return {
        kind: 'not_started',
        confidence: 'evidenced',
        summary: `Task is ${status}${assignee ? `; assigned to ${assignee}` : '; unassigned'}`,
        waitingOn: assignee,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
    }

    case 'approved': {
      return {
        kind: 'awaiting_completion',
        confidence: 'inferred',
        summary: 'Approved; awaiting done/completed',
        waitingOn: assignee,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
    }

    case 'completed':
    case 'done':
    case 'cancelled': {
      return {
        kind: 'terminal',
        confidence: 'evidenced',
        summary: `Task reached terminal status "${status}"`,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
    }

    case 'conflict': {
      return {
        kind: 'unknown',
        confidence: 'unknown',
        summary: 'Task is in conflict status; no automated explanation available',
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
    }

    default: {
      return {
        kind: 'unknown',
        confidence: 'unknown',
        summary: `No explanation available for status "${String(status)}"`,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Blocker analysis — meeting
// ---------------------------------------------------------------------------

function analyzeMeetingBlocker(
  meeting: MesaMeeting,
  events: MesaEvent[],
  tasks: WhyTaskSnapshot[],
  statusChain: WhyStatusStep[],
  lastActivityAt: string | null,
): WhyBlocker {
  const status = meeting.status;
  const lastStep = statusChain.at(-1);
  const since = lastStep && lastStep.to === status ? lastStep.at : meeting.updatedAt;
  const baseEvidence = lastStep && lastStep.to === status ? [lastStep.eventId] : [];

  switch (status) {
    case 'completed':
    case 'archived':
    case 'closed':
      return {
        kind: 'terminal',
        confidence: 'evidenced',
        summary: `Meeting is ${status} (terminal — immutable per the state machine)`,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };

    case 'paused': {
      const pause = lastEvent(events, (event) => event.type === 'meeting_status_changed');
      return {
        kind: 'paused',
        confidence: pause ? 'evidenced' : 'inferred',
        summary: `Meeting paused${pause ? ` by ${pause.actor} at ${pause.timestamp}` : ''}`,
        waitingOn: pause?.actor,
        since,
        lastActivityAt,
        evidenceEventIds: [...baseEvidence, ...(pause ? [pause.id] : [])],
      };
    }

    case 'planning':
      return {
        kind: 'not_started',
        confidence: 'inferred',
        summary: 'Meeting is in planning',
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };

    case 'open':
    case 'active': {
      const counts = new Map<string, number>();
      for (const task of tasks) {
        counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
      }
      const breakdown =
        tasks.length === 0
          ? 'no tasks tracked'
          : [...counts.entries()].map(([taskStatus, count]) => `${taskStatus}: ${count}`).join(', ');
      return {
        kind: 'active',
        confidence: 'evidenced',
        summary: `Meeting is ${status}; ${tasks.length} task(s) tracked`,
        since,
        lastActivityAt,
        detail: breakdown,
        evidenceEventIds: baseEvidence,
      };
    }

    default:
      return {
        kind: 'unknown',
        confidence: 'unknown',
        summary: `No explanation available for meeting status "${String(status)}"`,
        since,
        lastActivityAt,
        evidenceEventIds: baseEvidence,
      };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toRunRef(run: MesaAgentRun): WhyRunRef {
  return {
    runId: run.id,
    agentId: run.agentId,
    action: run.action,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error ? truncate(run.error, 200) : undefined,
    producedArtifactIds: [...run.producedArtifactIds],
  };
}

function toArtifactRef(artifact: MesaArtifact): WhyArtifactRef {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    createdBy: artifact.createdBy,
    createdAt: artifact.createdAt,
  };
}

/**
 * Rebuild the causal history of a task and explain why it sits in its
 * current status. Throws {@link TaskNotFoundError} when neither a task file
 * nor any related event exists.
 */
export function explainTask(ctx: MesaRuntimeContext, taskId: string): ExplainTaskResult {
  assertPolicy(ctx, 'event.read', `events:task:${taskId}`);

  let task: MesaTask | null = null;
  try {
    task = getTask(ctx, taskId);
  } catch (err) {
    if (!(err instanceof TaskNotFoundError)) throw err;
  }

  const related = eventsRelatedToTask(listEvents(ctx), taskId);
  if (!task && related.length === 0) {
    throw new TaskNotFoundError(taskId);
  }

  const runs = listAgentRuns(ctx, { taskId });
  const checks = listCheckResults(ctx, { taskId });
  const artifacts = listArtifacts(ctx, taskId);
  const statusChain = buildStatusChain({
    events: related,
    createdEventType: 'task_created',
    changedEventType: 'task_status_changed',
    fallbackInitialStatus: 'todo',
  });
  const lastActivityAt = related.at(-1)?.timestamp ?? null;
  const blocker = analyzeTaskBlocker(task, related, runs, checks, statusChain, lastActivityAt);

  return {
    entityType: 'task',
    taskId,
    title: task?.title,
    meetingId: task?.meetingId,
    currentStatus: task?.status ?? 'deleted',
    archived: task?.archived ?? false,
    deleted: task === null,
    statusChain,
    timeline: related.map(toTimelineEntry),
    blocker,
    relatedRuns: runs.map(toRunRef),
    relatedArtifacts: artifacts.map(toArtifactRef),
    lastActivityAt,
  };
}

/**
 * Rebuild the causal history of a meeting (its own stream plus every task
 * stream that belongs to it) and explain its current status.
 * Throws {@link MeetingNotFoundError} when the meeting does not exist.
 */
export function explainMeeting(ctx: MesaRuntimeContext, meetingId: string): ExplainMeetingResult {
  assertPolicy(ctx, 'event.read', `events:meeting:${meetingId}`);

  const meeting = getMeeting(ctx, meetingId);

  const taskIds = new Set<string>(meeting.tasks);
  const tasksInMeeting = listTasks(ctx).filter(
    (task) => task.meetingId === meetingId || taskIds.has(task.id),
  );
  for (const task of tasksInMeeting) {
    taskIds.add(task.id);
  }

  const related = listEvents(ctx).filter((event) => {
    if (event.meetingId === meetingId) return true;
    if (event.streamId === meetingId) return true;
    const eventIdTask = extractTaskId(event);
    return eventIdTask !== undefined && taskIds.has(eventIdTask);
  });

  const runs = listAgentRuns(ctx).filter(
    (run) => run.meetingId === meetingId || (run.taskId !== undefined && taskIds.has(run.taskId)),
  );
  const artifacts = listArtifacts(ctx).filter(
    (artifact) => artifact.meetingId === meetingId || (artifact.taskId !== undefined && taskIds.has(artifact.taskId)),
  );

  const statusChain = buildStatusChain({
    events: related,
    createdEventType: 'meeting_created',
    changedEventType: 'meeting_status_changed',
    fallbackInitialStatus: 'open',
  });
  const lastActivityAt = related.at(-1)?.timestamp ?? null;

  const taskSnapshots: WhyTaskSnapshot[] = [];
  const seen = new Set<string>();
  for (const task of tasksInMeeting) {
    taskSnapshots.push({ taskId: task.id, title: task.title, status: task.status });
    seen.add(task.id);
  }
  for (const taskId of meeting.tasks) {
    if (!seen.has(taskId)) {
      taskSnapshots.push({ taskId, status: 'missing' });
    }
  }

  const blocker = analyzeMeetingBlocker(meeting, related, taskSnapshots, statusChain, lastActivityAt);

  return {
    entityType: 'meeting',
    meetingId,
    title: meeting.title,
    currentStatus: meeting.status,
    statusChain,
    timeline: related.map(toTimelineEntry),
    blocker,
    tasks: taskSnapshots,
    relatedRuns: runs.map(toRunRef),
    relatedArtifacts: artifacts.map(toArtifactRef),
    lastActivityAt,
  };
}
