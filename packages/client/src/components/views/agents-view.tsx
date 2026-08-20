import { useMemo } from 'react';
import type { MesaAgent } from '@agentmesa/protocol';
import type { SetupStatus } from '../../api.js';
import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { AgentConnectionBadge } from '../ui/badge.js';
import { Avatar } from '../ui/avatar.js';
import { Button } from '../ui/button.js';
import { EmptyState } from '../ui/empty.js';
import { ViewPage } from './view-page.js';

function cliAvailableFor(setup: SetupStatus | undefined, agentId: string): boolean {
  if (!setup) return false;
  const side = setup[agentId as 'claude' | 'codex'];
  return side?.cliAvailable ?? false;
}

export function AgentsView({
  runtime,
  setup,
  onOpenDeploy,
}: {
  runtime: ReturnType<typeof useMesaRuntime>;
  setup?: SetupStatus;
  onOpenDeploy: () => void;
}) {
  const activeAgentIds = useMemo(
    () => new Set(runtime.activeRuns.map((run) => run.agentId)),
    [runtime.activeRuns],
  );

  return (
    <ViewPage title="Agent" count={runtime.agents.length}>
      {runtime.agents.length === 0 ? (
        <EmptyState
          title="还没有注册 Agent"
          detail="先去「部署与集成」页登记 Agent 身份，或执行 mesa agent add <id> <name>。"
          action={{ label: '去部署', onClick: onOpenDeploy }}
        />
      ) : (
        <div className="view-list">
          {runtime.agents.map((agent: MesaAgent) => (
            <div key={agent.id} className="view-row">
              <Avatar name={agent.name} agentId={agent.id} roles={agent.roles} size="lg" />
              <div className="view-row__body">
                <strong>{agent.name}</strong>
                <small>{agent.roles.join(' · ') || agent.id}</small>
              </div>
              <AgentConnectionBadge
                active={activeAgentIds.has(agent.id)}
                cliAvailable={cliAvailableFor(setup, agent.id)}
              />
            </div>
          ))}
        </div>
      )}
    </ViewPage>
  );
}
