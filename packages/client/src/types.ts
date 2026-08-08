import type { EventEnvelope, MesaAgentRun } from '@agentmesa/protocol';

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

declare global {
  interface Window {
    agentmesa?: DesktopBridge;
  }
}
