import type { EventEnvelope, MesaAgent, MesaAgentRun, MesaMessage, MesaMeeting, MesaRoom, MesaTask, MesaWorkspace, RoomMessage } from '@agentmesa/protocol';

export interface WorkflowState {
  workflowId: string;
  workflowDefinitionId: string;
  currentStep: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'waiting_approval';
  taskId: string;
  startedAt: string;
  completedAt?: string;
}

export interface RuntimeConfig {
  baseUrl: string;
  token?: string;
  view: 'widget' | 'main';
}

export interface DesktopBridge {
  toggleWidget(): Promise<void>;
  openMain(path?: string): Promise<void>;
  setWidgetExpanded(expanded: boolean): Promise<void>;
  hideWidget(): Promise<void>;
  minimizeMain(): Promise<void>;
  toggleMaximizeMain(): Promise<void>;
  closeMain(): Promise<void>;
}

export interface MesaSnapshot {
  runs: MesaAgentRun[];
  workflows: WorkflowState[];
  events: EventEnvelope[];
}

/** A meeting (session) together with its message timeline from the desk API. */
export type MeetingDetail = MesaMeeting & { messages: MesaMessage[] };

/** Registered workspaces + the active one, from GET /api/workspaces. */
export interface WorkspaceList {
  workspaces: MesaWorkspace[];
  activeWorkspaceId?: string;
}

/** A room together with its message timeline from the desk API. */
export type RoomDetail = MesaRoom & { messages: RoomMessage[]; totalMessages?: number };

/** Registered agents plus the tasks they are involved in, for session composition. */
export interface SessionComposition {
  meetings: MesaMeeting[];
  agents: MesaAgent[];
  tasks: MesaTask[];
}

declare global {
  interface Window {
    agentmesa?: DesktopBridge;
  }
}
