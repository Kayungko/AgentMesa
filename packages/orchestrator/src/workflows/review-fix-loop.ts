import type { WorkflowDefinition } from '../types.js';

/**
 * Defines the standard review/fix loop workflow.
 *
 * Steps:
 * 1. update_status -> in_progress
 * 2. run_agent (builder implements)
 * 3. update_status -> ready_for_review
 * 4. update_status -> reviewing
 * 5. run_agent (reviewer reviews; submits a verdict via mesa_submit_review,
 *    which lands directly on the task status)
 * 6. check (reads the task's real status; approved -> step 7, otherwise
 *    -> back to step 1, capped at 3 cycles. Loops re-enter through step 1
 *    (not step 2) because the protocol status graph only allows
 *    changes_requested -> in_progress, not changes_requested ->
 *    ready_for_review directly.)
 * 7. human_approval (user approves final delivery)
 * 8. update_status -> done
 *
 * Max 3 review cycles before requiring human decision.
 */
export function defineReviewFixLoop(): WorkflowDefinition {
  return {
    id: 'review-fix-loop',
    name: 'Review/Fix Loop',
    description: 'Standard review and fix cycle with max 3 iterations',
    startStep: 'step-1',
    steps: [
      {
        id: 'step-1',
        type: 'update_status',
        description: 'Mark task as in_progress',
        statusUpdate: 'in_progress',
        onSuccess: 'step-2',
      },
      {
        id: 'step-2',
        type: 'run_agent',
        runnerType: 'implement',
        agentId: 'builder',
        description: 'Builder implements the task',
        onSuccess: 'step-3',
        onFailure: 'abort',
      },
      {
        id: 'step-3',
        type: 'update_status',
        description: 'Mark task as ready_for_review',
        statusUpdate: 'ready_for_review',
        onSuccess: 'step-4',
      },
      {
        id: 'step-4',
        type: 'update_status',
        description: 'Mark task as reviewing',
        statusUpdate: 'reviewing',
        onSuccess: 'step-5',
      },
      {
        id: 'step-5',
        type: 'run_agent',
        runnerType: 'review',
        agentId: 'reviewer',
        description: 'Reviewer reviews the implementation',
        onSuccess: 'step-6',
        onFailure: 'step-7',
      },
      {
        id: 'step-6',
        type: 'check',
        description: 'Check review result (max 3 cycles)',
        condition: (context) => {
          const cycles = context.reviewCycles ?? 0;
          return context.approved === true || cycles >= 3;
        },
        onSuccess: 'step-7',
        // Loop back through step-1 (re-marks in_progress), not step-2
        // directly: changes_requested can't transition straight to
        // ready_for_review, only to in_progress.
        onFailure: 'step-1',
      },
      {
        id: 'step-7',
        type: 'human_approval',
        description: 'User approves final delivery',
        onSuccess: 'step-8',
        onFailure: 'abort',
      },
      {
        id: 'step-8',
        type: 'update_status',
        description: 'Mark task as done',
        statusUpdate: 'done',
        onSuccess: '__end__',
      },
    ],
  };
}
