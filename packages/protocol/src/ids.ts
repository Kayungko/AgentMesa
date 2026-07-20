/**
 * Shared ID generators for AgentMesa protocol entities.
 *
 * All IDs use the format `<prefix>_<8-char-uuid-slice>` generated via
 * `crypto.randomUUID()`. This ensures collision-resistant,
 * coordination-free IDs suitable for multi-agent local-first systems.
 */

/** Returns the first 8 hex characters of a random UUID v4. */
function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Generate a MesaTask ID. Format: `task_xxxxxxxx` */
export function generateTaskId(): string {
  return `task_${shortId()}`;
}

/** Generate a MesaMeeting ID. Format: `meeting_xxxxxxxx` */
export function generateMeetingId(): string {
  return `meeting_${shortId()}`;
}

/** Generate a MesaMessage ID. Format: `msg_xxxxxxxx` */
export function generateMessageId(): string {
  return `msg_${shortId()}`;
}

/** Generate a MesaArtifact ID. Format: `artifact_xxxxxxxx` */
export function generateArtifactId(): string {
  return `artifact_${shortId()}`;
}

/** Generate a MesaEvent ID. Format: `event_xxxxxxxx` */
export function generateEventId(): string {
  return `event_${shortId()}`;
}

/** Generate a MesaDecision ID. Format: `decision_xxxxxxxx` */
export function generateDecisionId(): string {
  return `decision_${shortId()}`;
}

/** Generate a MesaThread ID. Format: `thread_xxxxxxxx` */
export function generateThreadId(): string {
  return `thread_${shortId()}`;
}

/** Generate a MesaAgentRun ID. Format: `run_xxxxxxxx` */
export function generateAgentRunId(): string {
  return `run_${shortId()}`;
}

/** Generate a MesaClient ID. Format: `client_xxxxxxxx` */
export function generateClientId(): string {
  return `client_${shortId()}`;
}

/** Generate a Transport Envelope ID. Format: `env_xxxxxxxx` */
export function generateEnvelopeId(): string {
  return `env_${shortId()}`;
}

/** Generate a MesaCheckResult ID. Format: `check_xxxxxxxx` */
export function generateCheckResultId(): string {
  return `check_${shortId()}`;
}
