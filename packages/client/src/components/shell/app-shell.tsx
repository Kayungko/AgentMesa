import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MesaAgentRun } from '@agentmesa/protocol';
import { useMesaRuntime } from '../../useMesaRuntime.js';
import {
  createRoomEventStream,
  loadRooms,
  loadSetupStatus,
  loadWorkspaces,
  type RoomSummary,
  type SetupStatus,
} from '../../api.js';
import type { RuntimeConfig } from '../../types.js';
import { ConversationList } from '../conv/conversation-list.js';
import { MeetingChat } from '../chat/meeting-chat.js';
import { RoomChat } from '../chat/room-chat.js';
import { ChatEmpty } from '../chat/empty.js';
import { useMeetingDetail, useRoomDetail } from '../chat/hooks.js';
import {
  MeetingDrawerContent,
  RoomDrawerContent,
  StatusDrawer,
} from '../chat/status-drawer.js';
import { CreateSessionDialog } from '../dialog/create-session-dialog.js';
import { CreateRoomDialog } from '../dialog/create-room-dialog.js';
import { ImportSessionDialog } from '../dialog/import-session-dialog.js';
import { DeployView } from '../deploy/deploy-view.js';
import { AgentsView } from '../views/agents-view.js';
import { TasksView } from '../views/tasks-view.js';
import { ApprovalsView } from '../views/approvals-view.js';
import { ArchiveView } from '../views/archive-view.js';
import { Rail, type RailCounts } from './rail.js';
import { Titlebar } from './titlebar.js';
import { Statusbar } from './statusbar.js';
import { ToastHost, useToasts } from './toast.js';
import { parseHashRoute, type HashRoute, type Section } from './route.js';

// ---------------------------------------------------------------------------
// AppShell — the IM outer shell: rail / titlebar / 会话列表 / 聊天主区 /
// status drawer. Owns the two live streams: the shared global event stream
// (inside useMesaRuntime) and ONE room stream for every room.
// ---------------------------------------------------------------------------

export function AppShell({ config }: { config: RuntimeConfig }) {
  const runtime = useMesaRuntime(config);
  const { toast, push } = useToasts();
  const initialRoute = parseHashRoute();
  const [section, setSection] = useState<Section>(initialRoute.section);
  const [sessionId, setSessionId] = useState<string | undefined>(initialRoute.sessionId);
  const [roomId, setRoomId] = useState<string | undefined>(initialRoute.roomId);
  const [setup, setSetup] = useState<SetupStatus>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [roomStreamConnected, setRoomStreamConnected] = useState(false);
  const [roomVersion, setRoomVersion] = useState(0);
  const [selectedRun, setSelectedRun] = useState<MesaAgentRun>();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Hash is the single source of truth; navigation writes a hash, `hashchange`
  // applies it back so browser back/forward and deep links work.
  const applyRoute = useCallback((route: HashRoute) => {
    setSection(route.section);
    setSessionId(route.sessionId);
    setRoomId(route.roomId);
  }, []);

  useEffect(() => {
    const onHash = () => applyRoute(parseHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [applyRoute]);

  const go = useCallback((hash: string, route: HashRoute) => {
    if (window.location.hash === hash) {
      applyRoute(route); // same hash → apply directly (no hashchange fires)
      return;
    }
    window.location.hash = hash;
  }, [applyRoute]);

  const navigate = useCallback((next: Section) => {
    const hashes: Partial<Record<Section, [string, HashRoute]>> = {
      messages: ['#/', { section: 'messages' }],
      agents: ['#/agents', { section: 'agents' }],
      tasks: ['#/tasks', { section: 'tasks' }],
      approvals: ['#/approvals', { section: 'approvals' }],
      archive: ['#/archive', { section: 'archive' }],
    };
    const entry = hashes[next];
    if (entry) go(entry[0], entry[1]);
  }, [go]);

  const openConversation = useCallback((key: string) => {
    if (key.startsWith('meeting:')) {
      const id = key.slice('meeting:'.length);
      go(`#/sessions/${id}`, { section: 'sessions', sessionId: id });
    } else if (key.startsWith('room:')) {
      const id = key.slice('room:'.length);
      go(`#/rooms/${id}`, { section: 'rooms', roomId: id });
    }
  }, [go]);

  const openKey = section === 'sessions' && sessionId
    ? `meeting:${sessionId}`
    : section === 'rooms' && roomId
      ? `room:${roomId}`
      : undefined;

  useEffect(() => {
    loadSetupStatus(config).then(setSetup).catch(() => undefined);
  }, [config]);

  const refreshRooms = useCallback(() => {
    loadRooms(config).then(setRooms).catch(() => undefined);
  }, [config]);

  useEffect(() => refreshRooms(), [refreshRooms]);

  useEffect(() => {
    loadWorkspaces(config)
      .then((state) => {
        setWorkspaces(state.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })));
        setActiveWorkspaceId(state.activeWorkspaceId ?? '');
      })
      .catch(() => undefined);
  }, [config]);

  // Live room stream (SSE #2 — the only one besides the shared global stream):
  // a message in a closed room bumps its unread; a message in the open room
  // just refreshes the timeline. Room list previews update too.
  useEffect(() => {
    const stream = createRoomEventStream(
      config,
      (event) => {
        const key = `room:${event.roomId}`;
        if (openKey === key) {
          setUnread((prev) => ({ ...prev, [key]: 0 }));
          setRoomVersion((version) => version + 1);
        } else {
          setUnread((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
        }
        refreshRooms();
      },
      () => setRoomStreamConnected(true),
      () => setRoomStreamConnected(false),
    );
    return () => stream.close();
  }, [config, openKey, refreshRooms]);

  // Meeting unread: count live message_sent events for meetings that are not
  // open. Baseline = the newest event at mount; only live arrivals count.
  const seenEventCursorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const events = runtime.events;
    if (events.length === 0) return;
    const lastCursor = events[events.length - 1]!.cursor;
    if (seenEventCursorRef.current === undefined) {
      seenEventCursorRef.current = lastCursor;
      return;
    }
    if (seenEventCursorRef.current === lastCursor) return;
    const bumps: Record<string, number> = {};
    for (let i = events.length - 1; i >= 0; i--) {
      const envelope = events[i]!;
      if (envelope.cursor === seenEventCursorRef.current) break;
      const evt = envelope.event;
      if (evt.type === 'message_sent' && evt.meetingId) {
        const key = `meeting:${evt.meetingId}`;
        if (key !== openKey) bumps[key] = (bumps[key] ?? 0) + 1;
      }
    }
    seenEventCursorRef.current = lastCursor;
    if (Object.keys(bumps).length > 0) {
      setUnread((prev) => {
        const next = { ...prev };
        for (const [key, count] of Object.entries(bumps)) {
          next[key] = (next[key] ?? 0) + count;
        }
        return next;
      });
    }
  }, [runtime.events, openKey]);

  // Opening a conversation marks it read.
  useEffect(() => {
    if (!openKey) return;
    setUnread((prev) => (prev[openKey] ? { ...prev, [openKey]: 0 } : prev));
  }, [openKey]);

  const meeting = useMeetingDetail(config, section === 'sessions' ? sessionId : undefined, runtime.events);
  const room = useRoomDetail(config, section === 'rooms' ? roomId : undefined, roomVersion);

  const openMeetingId = section === 'sessions' ? sessionId : undefined;
  const openRoomId = section === 'rooms' ? roomId : undefined;

  const counts: RailCounts = useMemo(() => ({
    unread: Object.values(unread).reduce((sum, count) => sum + count, 0),
    tasks: runtime.tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length,
    approvals: runtime.waiting.length,
  }), [unread, runtime.tasks, runtime.waiting]);

  const drawerKind = openMeetingId ? 'meeting' : openRoomId ? 'room' : undefined;

  return (
    <main className={`chat-shell ${openMeetingId || openRoomId ? '' : 'chat-shell--noctx'}`}>
      <Rail
        view={section}
        counts={counts}
        onNavigate={navigate}
        onOpenDeploy={() => go('#/deploy', { section: 'deploy' })}
      />

      <div className="shell-body">
        <Titlebar config={config} connection={runtime.connection} />

        <div className={`shell-columns ${drawerOpen && drawerKind ? 'shell-columns--drawer' : ''}`}>
          <ConversationList
            runtime={runtime}
            rooms={rooms}
            unread={unread}
            activeKey={openKey}
            onOpen={openConversation}
            onCreateSession={() => go('#/sessions/new', { section: 'sessions-new' })}
            onCreateRoom={() => go('#/rooms/new', { section: 'rooms-new' })}
            onImportSession={() => go('#/sessions/import', { section: 'sessions-import' })}
          />

          {section === 'deploy' ? (
            <section className="chat-main chat-main--page">
              {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}
              <DeployView config={config} />
            </section>
          ) : section === 'agents' ? (
            <AgentsView runtime={runtime} setup={setup} onOpenDeploy={() => go('#/deploy', { section: 'deploy' })} />
          ) : section === 'tasks' ? (
            <TasksView config={config} runtime={runtime} />
          ) : section === 'approvals' ? (
            <ApprovalsView runtime={runtime} />
          ) : section === 'archive' ? (
            <ArchiveView config={config} runtime={runtime} onOpen={(id) => go(`#/sessions/${id}`, { section: 'sessions', sessionId: id })} />
          ) : openMeetingId ? (
            <MeetingChat
              config={config}
              runtime={runtime}
              meetingId={openMeetingId}
              detail={meeting.detail}
              loading={meeting.loading}
              loadError={meeting.error}
              reload={() => meeting.reload()}
              onSelectRun={setSelectedRun}
              onOpenDrawer={() => setDrawerOpen(true)}
              onStub={(label) => push(`${label}将在后续原型中展开`)}
            />
          ) : openRoomId ? (
            <RoomChat
              config={config}
              roomId={openRoomId}
              detail={room.detail}
              reload={() => room.reload()}
              activeWorkspaceId={activeWorkspaceId}
              streamConnected={roomStreamConnected}
              onOpenDrawer={() => setDrawerOpen(true)}
              onStub={(label) => push(`${label}将在后续原型中展开`)}
            />
          ) : (
            <section className="chat-main">
              {runtime.error ? <div className="banner banner--error">{runtime.error}</div> : null}
              <ChatEmpty
                title="选择或开始一个会话"
                detail="左侧是会话与群聊列表。新建会话把 Agent 拉进同一张工作台，或建群做跨项目协作。"
                action={{ label: '新建会话', onClick: () => go('#/sessions/new', { section: 'sessions-new' }) }}
              />
            </section>
          )}

          {drawerOpen && drawerKind ? (
            <StatusDrawer
              onClose={() => setDrawerOpen(false)}
              title={drawerKind === 'meeting' ? meeting.detail?.title ?? '' : room.detail?.name ?? ''}
            >
              {drawerKind === 'meeting' ? (
                <MeetingDrawerContent
                  config={config}
                  runtime={runtime}
                  setup={setup}
                  meetingId={openMeetingId!}
                  detail={meeting.detail}
                  reload={() => meeting.reload()}
                  setDetail={meeting.setDetail}
                  selectedRun={selectedRun}
                  onSelectRun={setSelectedRun}
                />
              ) : (
                <RoomDrawerContent
                  config={config}
                  detail={room.detail}
                  reload={() => room.reload()}
                  workspaces={workspaces}
                />
              )}
            </StatusDrawer>
          ) : null}
        </div>

        <Statusbar
          connection={runtime.connection}
          runs={runtime.runs.length}
          waiting={runtime.waiting.length}
          workflows={runtime.workflows.length}
        />
      </div>

      {section === 'sessions-new' ? (
        <CreateSessionDialog
          runtime={runtime}
          onCreated={(id) => go(`#/sessions/${id}`, { section: 'sessions', sessionId: id })}
          onClose={() => go('#/', { section: 'home' })}
        />
      ) : null}
      {section === 'rooms-new' ? (
        <CreateRoomDialog
          config={config}
          onCreated={(id) => { void refreshRooms(); go(`#/rooms/${id}`, { section: 'rooms', roomId: id }); }}
          onClose={() => go('#/', { section: 'home' })}
        />
      ) : null}
      {section === 'sessions-import' ? (
        <ImportSessionDialog
          config={config}
          onCreated={(id) => {
            // 导入的会议不在 useMesaRuntime 的既有数据里，手动刷新会话列表后跳转。
            void runtime.refresh();
            go(`#/sessions/${id}`, { section: 'sessions', sessionId: id });
          }}
          onClose={() => go('#/', { section: 'home' })}
        />
      ) : null}

      <ToastHost toast={toast} />
    </main>
  );
}
