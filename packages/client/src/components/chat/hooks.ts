import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventEnvelope } from '@agentmesa/protocol';
import { loadMeeting, loadRoom } from '../../api.js';
import type { MeetingDetail, RoomDetail, RuntimeConfig } from '../../types.js';

// ---------------------------------------------------------------------------
// Meeting detail hook — owns the fetch + SSE-driven live refresh for ONE open
// meeting. Live refresh rides the SHARED global event stream (useMesaRuntime),
// so no second EventSource is opened per conversation.
// ---------------------------------------------------------------------------

export function useMeetingDetail(config: RuntimeConfig, meetingId: string | undefined, events: EventEnvelope[]) {
  const [detail, setDetail] = useState<MeetingDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Cursors already accounted for; only envelopes after this can trigger reload.
  const seenCursorRef = useRef<string | undefined>(undefined);

  const reload = useCallback(() => {
    if (!meetingId) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    loadMeeting(config, meetingId)
      .then((next) => { if (active) setDetail(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, meetingId]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    seenCursorRef.current = events.length > 0 ? events[events.length - 1]!.cursor : undefined;
    return reload();
    // Reset + load only when the opened meeting changes, not on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // Live refresh: scan envelopes newer than the seen cursor; any event that
  // belongs to this meeting (message, meeting change, its tasks) re-fetches.
  useEffect(() => {
    if (!meetingId || events.length === 0) return;
    if (seenCursorRef.current === undefined) {
      seenCursorRef.current = events[events.length - 1]!.cursor;
      return;
    }
    let dirty = false;
    for (let i = events.length - 1; i >= 0; i--) {
      const envelope = events[i]!;
      if (envelope.cursor === seenCursorRef.current) break;
      const evt = envelope.event;
      const taskMeetingId = (evt.data as { task?: { meetingId?: string } } | undefined)?.task?.meetingId;
      if (evt.meetingId === meetingId || taskMeetingId === meetingId) {
        dirty = true;
        break;
      }
    }
    seenCursorRef.current = events[events.length - 1]!.cursor;
    if (dirty) reload();
  }, [events, meetingId, reload]);

  return { detail, loading, error, reload, setDetail };
}

// ---------------------------------------------------------------------------
// Room detail hook — fetch + poll fallback; live bumps come from the shell's
// room stream via `version`.
// ---------------------------------------------------------------------------

export function useRoomDetail(config: RuntimeConfig, roomId: string | undefined, version: number) {
  const [detail, setDetail] = useState<RoomDetail>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    if (!roomId) return;
    let active = true;
    loadRoom(config, roomId)
      .then((next) => { if (active) setDetail(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [config, roomId]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    return reload();
  }, [reload]);

  // Version bumps from the live room stream, plus a low-frequency poll as a
  // fallback for silent drops (the stream carries the real-time path).
  useEffect(() => {
    if (!roomId || version === 0) return;
    return reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    if (!roomId) return;
    const timer = setInterval(() => reload(), 30_000);
    return () => clearInterval(timer);
  }, [roomId, reload]);

  return { detail, error, reload, setDetail };
}
