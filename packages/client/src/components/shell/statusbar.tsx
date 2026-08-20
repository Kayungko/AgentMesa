import { ConnectionBadge } from '../ui/badge.js';
import type { ConnectionState } from '../../useMesaRuntime.js';

export function Statusbar({
  connection,
  runs,
  waiting,
  workflows,
}: {
  connection: ConnectionState;
  runs: number;
  waiting: number;
  workflows: number;
}) {
  return (
    <footer className="statusbar">
      <ConnectionBadge state={connection} />
      <span>{runs} 个运行 · {waiting} 个待审批 · {workflows} 个工作流</span>
      <span>AgentMesa 桌面版</span>
    </footer>
  );
}
