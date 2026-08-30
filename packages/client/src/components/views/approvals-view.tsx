import type { useMesaRuntime } from '../../useMesaRuntime.js';
import { ApprovalCard } from '../cards/approval-card.js';
import { PermissionApprovalCard } from '../cards/permission-approval-card.js';
import { EmptyState } from '../ui/empty.js';
import { ViewPage } from './view-page.js';

export function ApprovalsView({ runtime }: { runtime: ReturnType<typeof useMesaRuntime> }) {
  const pendingPermissions = runtime.pendingPermissions;
  const total = runtime.waiting.length + pendingPermissions.length;

  return (
    <ViewPage title="审批" count={total}>
      {total === 0 ? (
        <EmptyState title="没有待审批" detail="Agent 需要你的决策时，审批卡片会出现在这里和会话流里。" />
      ) : (
        <div className="view-list view-list--cards">
          {pendingPermissions.map((approval) => (
            <PermissionApprovalCard
              key={approval.id}
              approval={approval}
              onDecide={(decision) => runtime.decidePermission(approval.id, decision)}
            />
          ))}
          {runtime.waiting.map((workflow) => (
            <ApprovalCard
              key={workflow.workflowId}
              workflow={workflow}
              task={runtime.tasks.find((task) => task.id === workflow.taskId)}
              onDecide={(decision, message) => runtime.decide(workflow.workflowId, decision, message)}
            />
          ))}
        </div>
      )}
    </ViewPage>
  );
}
