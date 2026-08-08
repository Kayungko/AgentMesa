import type { EventEnvelope } from '@agentmesa/protocol';
import type { RuntimeConfig, WorkflowState } from './types.js';

function headers(config: RuntimeConfig, json = false): HeadersInit {
  return {
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function request<T>(config: RuntimeConfig, path: string): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, { headers: headers(config) });
  if (!response.ok) {
    throw new Error(`Desk request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function loadRuns(config: RuntimeConfig) {
  return request<import('@agentmesa/protocol').MesaAgentRun[]>(config, '/api/runs');
}

export function loadWorkflows(config: RuntimeConfig) {
  return request<WorkflowState[]>(config, '/api/workflows');
}

export function loadEvents(config: RuntimeConfig, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=500` : '?limit=500';
  return request<EventEnvelope[]>(config, `/api/events${query}`);
}

export async function decideWorkflow(
  config: RuntimeConfig,
  workflowId: string,
  decision: 'approve' | 'reject',
  message?: string,
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/decision`, {
    method: 'POST',
    headers: headers(config, true),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      decision,
      ...(decision === 'reject' ? { reason: message || 'Rejected from desktop widget' } : {}),
      ...(message ? { message } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new Error(body.error ?? `Decision failed (${response.status})`);
  }
}

export function createEventStream(
  config: RuntimeConfig,
  cursor: string | undefined,
  onEvent: (event: EventEnvelope) => void,
  onOpen: () => void,
  onError: () => void,
): EventSource {
  const params = new URLSearchParams();
  if (config.token) params.set('access_token', config.token);
  if (cursor) params.set('cursor', cursor);
  const stream = new EventSource(`${config.baseUrl}/api/events/stream?${params}`);
  stream.addEventListener('open', onOpen);
  stream.addEventListener('error', onError);
  stream.addEventListener('mesa-event', (raw) => {
    onEvent(JSON.parse((raw as MessageEvent<string>).data) as EventEnvelope);
  });
  return stream;
}
