import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventEnvelope, MesaAgent, MesaAgentRun, MesaMeeting, MesaTask } from '@agentmesa/protocol';
import {
  addMeetingAgent,
  createEventStream,
  createMeeting,
  createTask,
  decidePermission as decidePermissionApi,
  decideWorkflow,
  listPendingPermissions,
  loadAgents,
  loadMeetings,
  loadRuns,
  loadTasks,
  loadWorkflows,
} from './api.js';
import type { PendingPermissionApproval, RuntimeConfig, WorkflowState } from './types.js';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const MAX_EVENTS = 100;

/**
 * Driver permission approvals live in the desk process (not the workspace
 * event log), so the SSE stream never announces them — poll for them instead,
 * at the same cadence the approvals view otherwise refreshes.
 */
const PERMISSION_POLL_MS = 5_000;

export function useMesaRuntime(config: RuntimeConfig) {
  const cursorKey = `agentmesa.event.cursor.${config.view}`;
  const [runs, setRuns] = useState<MesaAgentRun[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowState[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionApproval[]>([]);
  const [meetings, setMeetings] = useState<MesaMeeting[]>([]);
  const [agents, setAgents] = useState<MesaAgent[]>([]);
  const [tasks, setTasks] = useState<MesaTask[]>([]);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const cursorRef = useRef<string | undefined>(localStorage.getItem(cursorKey) ?? undefined);
  const seenRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const [nextRuns, nextWorkflows, nextMeetings, nextAgents, nextTasks, nextPermissions] = await Promise.all([
      loadRuns(config),
      loadWorkflows(config),
      loadMeetings(config),
      loadAgents(config),
      loadTasks(config),
      listPendingPermissions(config),
    ]);
    setRuns(nextRuns);
    setWorkflows(nextWorkflows);
    setMeetings(nextMeetings);
    setAgents(nextAgents);
    setTasks(nextTasks);
    setPendingPermissions(nextPermissions.pending);
    setError(undefined);
    setLoaded(true);
  }, [config]);

  useEffect(() => {
    let active = true;
    refresh().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setConnection('offline');
      setLoaded(true);
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
          envelope.event.streamType === 'workflow' ||
          envelope.event.streamType === 'meeting' ||
          envelope.event.streamType === 'task' ||
          envelope.event.streamType === 'message'
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
        // A persisted cursor can outlive the server's event log; drop it so a
        // reconnect starts from a clean replay instead of looping on the error.
        localStorage.removeItem(cursorKey);
        cursorRef.current = undefined;
        setConnection((current) => current === 'connecting' ? 'offline' : 'reconnecting');
      },
    );

    return () => {
      active = false;
      stream.close();
    };
  }, [config, cursorKey, refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      listPendingPermissions(config)
        .then((result) => setPendingPermissions(result.pending))
        .catch(() => undefined);
    }, PERMISSION_POLL_MS);
    return () => clearInterval(interval);
  }, [config]);

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

  const decidePermission = useCallback(async (id: string, decision: 'allow' | 'deny' | 'allow_session') => {
    await decidePermissionApi(config, id, decision);
    const result = await listPendingPermissions(config);
    setPendingPermissions(result.pending);
  }, [config]);

  const createSession = useCallback(async (
    input: { title: string; purpose?: string; agents?: string[] },
  ): Promise<MesaMeeting> => {
    const meeting = await createMeeting(config, input);
    await refresh();
    return meeting;
  }, [config, refresh]);

  const inviteAgent = useCallback(async (
    meetingId: string,
    agentId: string,
  ): Promise<MesaMeeting> => {
    const meeting = await addMeetingAgent(config, meetingId, agentId);
    await refresh();
    return meeting;
  }, [config, refresh]);

  const createTaskInSession = useCallback(async (
    input: {
      title: string;
      description?: string;
      assignedTo?: string;
      reviewer?: string;
      meetingId?: string;
    },
  ): Promise<MesaTask> => {
    const task = await createTask(config, input);
    await refresh();
    return task;
  }, [config, refresh]);

  return {
    runs,
    workflows,
    meetings,
    agents,
    tasks,
    events,
    waiting,
    pendingPermissions,
    activeRuns,
    failedRuns,
    connection,
    error,
    loaded,
    refresh,
    decide,
    decidePermission,
    createSession,
    inviteAgent,
    createTaskInSession,
  };
}
