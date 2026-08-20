import type { RuntimeConfig } from '../../types.js';

export type Section =
  | 'home'
  | 'messages'
  | 'agents'
  | 'tasks'
  | 'approvals'
  | 'archive'
  | 'sessions'
  | 'sessions-new'
  | 'rooms'
  | 'rooms-new'
  | 'deploy';

export interface HashRoute {
  section: Section;
  sessionId?: string;
  roomId?: string;
}

export function readConfig(): RuntimeConfig {
  const params = new URLSearchParams(window.location.search);
  return {
    baseUrl: params.get('baseUrl') ?? 'http://127.0.0.1:3456',
    token: params.get('token') ?? undefined,
    view: params.get('view') === 'widget' ? 'widget' : 'main',
  };
}

// ---------------------------------------------------------------------------
// Routing — the hash is the single source of truth for the open conversation.
// Deep links (#/sessions/:id, #/rooms/:id, #/deploy) keep working.
// ---------------------------------------------------------------------------

export function parseHashRoute(): HashRoute {
  const h = window.location.hash;
  if (h.startsWith('#/sessions/new')) return { section: 'sessions-new' };
  if (h.startsWith('#/rooms/new')) return { section: 'rooms-new' };
  if (h.startsWith('#/sessions/')) {
    return { section: 'sessions', sessionId: h.slice('#/sessions/'.length).split('/')[0] };
  }
  if (h.startsWith('#/rooms/')) {
    return { section: 'rooms', roomId: h.slice('#/rooms/'.length).split('/')[0] };
  }
  if (h.startsWith('#/sessions')) return { section: 'messages' };
  if (h.startsWith('#/rooms')) return { section: 'messages' };
  if (h.startsWith('#/deploy')) return { section: 'deploy' };
  if (h.startsWith('#/agents')) return { section: 'agents' };
  if (h.startsWith('#/tasks')) return { section: 'tasks' };
  if (h.startsWith('#/approvals')) return { section: 'approvals' };
  if (h.startsWith('#/archive')) return { section: 'archive' };
  return { section: 'home' };
}
