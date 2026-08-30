export { DeskServer } from './server.js';
export { generateDashboardHtml } from './dashboard.js';
export {
  PermissionApprovalQueue,
  createDeskAskHuman,
  DEFAULT_PERMISSION_TIMEOUT_MS,
} from './permission-approvals.js';
export type {
  PendingPermissionApproval,
  PermissionApprovalEnqueueOptions,
} from './permission-approvals.js';
