import { ConnectionBadge } from '../ui/badge.js';
import type { ConnectionState } from '../../useMesaRuntime.js';
import { WorkspaceSwitcher } from './workspace-switcher.js';
import type { RuntimeConfig } from '../../types.js';

export function Titlebar({ config, connection }: { config: RuntimeConfig; connection: ConnectionState }) {
  return (
    <header className="titlebar draggable">
      <div className="titlebar__brand">
        <span className="brand-mark">M</span>
        <span>AgentMesa</span>
      </div>
      <div className="titlebar__workspace no-drag">
        <WorkspaceSwitcher config={config} />
      </div>
      <div className="titlebar__right no-drag">
        <ConnectionBadge state={connection} />
        <div className="window-controls">
          <button type="button" aria-label="最小化" onClick={() => window.agentmesa?.minimizeMain()}>−</button>
          <button type="button" aria-label="最大化" onClick={() => window.agentmesa?.toggleMaximizeMain()}>□</button>
          <button type="button" aria-label="关闭" onClick={() => window.agentmesa?.closeMain()}>×</button>
        </div>
      </div>
    </header>
  );
}
