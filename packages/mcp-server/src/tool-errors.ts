import { ZodError } from 'zod';
import { MesaError } from '@agentmesa/core';
import type { MesaErrorCode } from '@agentmesa/core';

/**
 * Unified, self-healing error contract for every `mesa_*` MCP tool.
 *
 * A tool failure is only useful to an AI caller if it answers three questions:
 * - **what** failed — which tool, which parameter or resource, with the actual
 *   value the caller sent;
 * - **why** it failed — an error category the agent can reason about
 *   (invalid value / unknown id / permission / precondition / conflict);
 * - **fix** — a concrete, executable next step ("legal roles are …", "call
 *   mesa_invite_to_room first", "re-fetch the cursor via mesa_poll_rooms").
 *
 * `ToolError` is thrown for failures detected in the MCP layer itself; errors
 * bubbling up from `@agentmesa/core` are translated into the same shape by
 * {@link describeToolError} at the envelope boundary, so every `isError`
 * response carries the full contract.
 */

/** Error categories an AI agent can act on — the "why" of a tool failure. */
export type ToolErrorCode =
  | 'invalid_value'
  | 'unknown_id'
  | 'permission_denied'
  | 'precondition_not_met'
  | 'conflict'
  | 'internal';

export const TOOL_ERROR_CODES: readonly ToolErrorCode[] = [
  'invalid_value',
  'unknown_id',
  'permission_denied',
  'precondition_not_met',
  'conflict',
  'internal',
];

/** One-sentence explanation per category — the `why` field of the envelope. */
const CODE_WHY: Record<ToolErrorCode, string> = {
  invalid_value: 'invalid argument value',
  unknown_id: 'unknown or non-existent id',
  permission_denied: 'insufficient permission for the current actor',
  precondition_not_met: 'precondition not met',
  conflict: 'conflicting concurrent state',
  internal: 'internal error',
};

/** The structured error payload every failed tool call returns. */
export interface ToolErrorDetails {
  /** The failing `mesa_*` tool name. */
  tool: string;
  /** Error category (see {@link ToolErrorCode}). */
  code: ToolErrorCode;
  /** What failed, including the actual values received. */
  what: string;
  /** Why it failed — the category as a sentence. */
  why: string;
  /** A concrete, executable fix the caller can apply before retrying. */
  fix: string;
  /** Original human-readable error message (kept for compatibility). */
  message: string;
}

/** Structured tool failure carrying the what/why/fix contract. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  /** Filled in at the envelope boundary (the throw site may not know it). */
  tool: string;

  constructor(
    code: ToolErrorCode,
    what: string,
    fix: string,
    options?: { tool?: string; cause?: unknown },
  ) {
    super(`${what} Fix: ${fix}`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ToolError';
    this.code = code;
    this.what = what;
    this.why = CODE_WHY[code];
    this.fix = fix;
    this.tool = options?.tool ?? '';
  }
}

/**
 * Build a {@link ToolError} from the three contract elements.
 *
 * @param code error category — the "why" (e.g. `'unknown_id'`).
 * @param what what failed, including the actual value received.
 * @param fix  concrete repair instruction (mention real `mesa_*` tool names).
 */
export function toolError(code: ToolErrorCode, what: string, fix: string): ToolError {
  return new ToolError(code, what, fix);
}

/** A parameter value is not part of the closed set of legal values. */
export function invalidValueError(
  param: string,
  value: unknown,
  allowed: readonly string[],
): ToolError {
  return toolError(
    'invalid_value',
    `Parameter "${param}" received invalid value "${String(value)}".`,
    `Use one of: ${allowed.join(', ')}.`,
  );
}

/** A referenced entity (task, room, run, …) does not exist. */
export function unknownIdError(param: string, value: string, listTool: string): ToolError {
  return toolError(
    'unknown_id',
    `No entity found for ${param} "${value}".`,
    `Call ${listTool} to discover valid IDs, then retry with an existing ${param}.`,
  );
}

// ---------------------------------------------------------------------------
// Translation of core/runner/connector errors into the contract
// ---------------------------------------------------------------------------

interface MesaErrorGuidance {
  code: ToolErrorCode;
  fix: string;
}

/**
 * Fix guidance per `MesaErrorCode`. The `what` is always the original core
 * error message — it already names the failing resource and value
 * (e.g. `Task not found: task_01H…`).
 */
const MESA_ERROR_GUIDANCE: Record<MesaErrorCode, MesaErrorGuidance> = {
  TASK_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_tasks to discover valid task IDs, then retry with an existing taskId.',
  },
  MEETING_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_meetings to discover valid meeting IDs, then retry with an existing meetingId.',
  },
  ARTIFACT_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_artifacts to discover valid artifact IDs, then retry with an existing artifactId.',
  },
  AGENT_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_agents to discover registered agent IDs, or register the agent first with mesa_register_agent.',
  },
  RUN_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_runs to discover valid run IDs, or create a new run with mesa_create_run.',
  },
  CHECK_RESULT_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_checks to discover valid check IDs, then retry with an existing checkId.',
  },
  ROOM_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Call mesa_list_rooms to discover valid room IDs, then retry with an existing roomId.',
  },
  WORKSPACE_NOT_FOUND: {
    code: 'unknown_id',
    fix: 'Pass a workspaceId that is registered in the workspace registry, or omit workspaceId to operate on the server default workspace.',
  },
  WORKSPACE_ALREADY_EXISTS: {
    code: 'conflict',
    fix: 'A workspace already exists at that location — operate on it instead of creating a duplicate.',
  },
  INVALID_STATUS_TRANSITION: {
    code: 'precondition_not_met',
    fix: 'Read the current status first (mesa_read_task for tasks, mesa_read_run for runs), then choose a status reachable from it.',
  },
  POLICY_DENIED: {
    code: 'permission_denied',
    fix: 'The MCP actor lacks the required role. Ask the operator to reconnect with additional roles (AGENTMESA_MCP_ACTOR_ROLES for stdio, the x-agentmesa-actor-roles header for HTTP), or use a tool your roles allow.',
  },
  VALIDATION_ERROR: {
    code: 'invalid_value',
    fix: 'Check the failed argument against the tool input schema and retry with a valid value.',
  },
  LOCK_ERROR: {
    code: 'conflict',
    fix: 'Another process holds the lock on this resource — wait briefly and retry the same call.',
  },
  PROJECTION_MISSING: {
    code: 'precondition_not_met',
    fix: 'The projection has not been built yet. Read the entity directly (mesa_read_task / mesa_read_meeting), or run `mesa rebuild` to rebuild projections.',
  },
  PROJECTION_STALE: {
    code: 'precondition_not_met',
    fix: 'The projection is behind the event log. Read the entity directly (mesa_read_task / mesa_read_meeting), or run `mesa rebuild` to rebuild projections.',
  },
  TRANSPORT_NOT_FOUND: {
    code: 'precondition_not_met',
    fix: 'The workspace file transport is unavailable — verify the workspace is initialized (`mesa init`) and retry.',
  },
  STORAGE_ERROR: {
    code: 'internal',
    fix: 'A filesystem operation failed (see message). Verify disk access and paths, then retry; if it persists, report it to the operator.',
  },
};

/** Sharper fixes for core VALIDATION_ERRORs whose generic fix is too vague. */
function refineValidationError(message: string): { code: ToolErrorCode; fix: string } | undefined {
  if (message.includes('cursor')) {
    return {
      code: 'invalid_value',
      fix: 'The cursor is stale or unknown. Call mesa_poll_rooms (or mesa_list_room_messages) without a cursor to fetch the current one, then retry with it — silently skipping would drop messages.',
    };
  }
  if (message.includes('impersonation')) {
    return {
      code: 'permission_denied',
      fix: 'Speak as yourself: set fromRef to the ref part of your actor id (the segment after the colon). You cannot post on behalf of another room member.',
    };
  }
  if (message.includes('not a member of room')) {
    return {
      code: 'precondition_not_met',
      fix: 'Invite the sender first with mesa_invite_to_room (roomId, workspaceId, kind, ref), then retry mesa_send_room_message.',
    };
  }
  if (message.includes('mentions reference non-members')) {
    return {
      code: 'precondition_not_met',
      fix: 'Mention only refs of current members (see mesa_list_rooms). Invite missing members via mesa_invite_to_room, or drop the unknown mentions.',
    };
  }
  return undefined;
}

function zodWhat(error: ZodError): string {
  const issues = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return `Arguments failed schema validation — ${issues.join('; ')}${
    error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : ''
  }.`;
}

/**
 * Translate any error thrown inside a tool handler into the unified
 * what/why/fix contract. `ToolError`s pass through unchanged (gaining the
 * tool name); `MesaError`s are mapped by code; Zod errors list the failing
 * arguments; anything else is reported as an internal error.
 */
export function describeToolError(tool: string, error: unknown): ToolErrorDetails {
  if (error instanceof ToolError) {
    return {
      tool,
      code: error.code,
      what: error.what,
      why: error.why,
      fix: error.fix,
      message: error.message,
    };
  }
  if (error instanceof MesaError) {
    const refined =
      error.code === 'VALIDATION_ERROR' ? refineValidationError(error.message) : undefined;
    const guidance = refined ?? MESA_ERROR_GUIDANCE[error.code];
    return {
      tool,
      code: guidance.code,
      what: error.message,
      why: CODE_WHY[guidance.code],
      fix: guidance.fix,
      message: error.message,
    };
  }
  if (error instanceof ZodError) {
    return {
      tool,
      code: 'invalid_value',
      what: zodWhat(error),
      why: CODE_WHY.invalid_value,
      fix: 'Use argument values allowed by the tool input schema — the failing arguments and the expected shapes are listed above.',
      message: error.message,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    tool,
    code: 'internal',
    what: message,
    why: CODE_WHY.internal,
    fix: 'Unexpected failure — inspect the message above; if it persists, report it to the operator. Retrying with identical arguments is unlikely to help.',
    message,
  };
}

/** MCP `isError` result payload for a failed tool call. */
export type ToolErrorResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  // Index signature so the result satisfies the SDK's CallToolResult shape.
  [key: string]: unknown;
};

/**
 * Render a caught error as an MCP tool result: `isError: true` with a JSON
 * body carrying the full what/why/fix contract. This is the single error
 * envelope used by every registered `mesa_*` tool.
 */
export function toolErrorResult(tool: string, error: unknown): ToolErrorResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: describeToolError(tool, error) }) }],
    isError: true,
  };
}
