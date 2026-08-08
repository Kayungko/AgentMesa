import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventEnvelope, MesaAgentRun } from '@agentmesa/protocol';
import { createEventStream, decideWorkflow, loadRuns, loadWorkflows } from './api.js';
import type { RuntimeConfig, WorkflowState } from './types.js';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const MAX_EVENTS = 100;

export function useMesaRuntime(config: RuntimeConfig) {
  const cursorKey = `agentmesa.event.cursor.${config.view}`;
  const [runs, setRuns] = useState<MesaAgentRun[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowState[]>([]);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string>();
  const cursorRef = useRef<string | undefined>(localStorage.getItem(cursorKey) ?? undefined);
  const seenRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const [nextRuns, nextWorkflows] = await Promise.all([
      loadRuns(config),
      loadWorkflows(config),
    ]);
    setRuns(nextRuns);
    setWorkflows(nextWorkflows);
    setError(undefined);
  }, [config]);

  useEffect(() => {
    let active = true;
    refresh().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setConnection('offline');
    });

    const stream = createEventStream(
      config,
      cursorRef.current,
      (envelope) => {
        if (!active || seenRef.current.has(envelope.cursor)) return;
        seenRef.current.add(envelope.cursor);
        if (seenRef.current.size > MAX_EVENTS * 2) {
          const recent = [...seenRef.current].slice(-MAX_EVENTS);
          seenRef.current = new Set(recent);
        }
        cursorRef.current = envelope.cursor;
        localStorage.setItem(cursorKey, envelope.cursor);
        setEvents((current) => [...current, envelope].slice(-MAX_EVENTS));
        if (
          envelope.event.streamType === 'agent_run' ||
          envelope.event.streamType === 'workflow'
        ) {
          refresh().catch(() => undefined);
        }
      },
      () => {
        if (!active) return;
        setConnection('connected');
        setError(undefined);
      },
      () => {
        if (!active) return;
        setConnection((current) => current === 'connecting' ? 'offline' : 'reconnecting');
      },
    );

    return () => {
      active = false;
      stream.close();
    };
  }, [config, cursorKey, refresh]);

  const waiting = useMemo(
    () => workflows.filter((workflow) => workflow.status === 'waiting_approval'),
    [workflows],
  );
  const activeRuns = useMemo(
    () => runs.filter((run) => run.status === 'pending' || run.status === 'running'),
    [runs],
  );
  const failedRuns = useMemo(
    () => runs.filter((run) => run.status === 'failed'),
    [runs],
  );

  const decide = useCallback(async (
    workflowId: string,
    decision: 'approve' | 'reject',
    message?: string,
  ) => {
    await decideWorkflow(config, workflowId, decision, message);
    await refresh();
  }, [config, refresh]);

  return {
    runs,
    workflows,
    events,
    waiting,
    activeRuns,
    failedRuns,
    connection,
    error,
    refresh,
    decide,
  };
}
