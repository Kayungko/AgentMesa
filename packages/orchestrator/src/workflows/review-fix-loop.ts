import type { WorkflowDefinition } from '../types.js';

/**
 * Defines the standard review/fix loop workflow.
 *
 * Steps:
 * 1. update_status -> in_progress
 * 2. run_agent (builder implements)
 * 3. update_status -> ready_for_review
 * 4. run_agent (reviewer reviews)
 * 5. check (if approved -> step 6, if changes_requested -> back to step 2)
 * 6. human_approval (user approves final delivery)
 * 7. update_status -> done
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
        type: 'run_agent',
        runnerType: 'review',
        agentId: 'reviewer',
        description: 'Reviewer reviews the implementation',
        onSuccess: 'step-5',
        onFailure: 'step-6',
      },
      {
        id: 'step-5',
        type: 'check',
        description: 'Check review result (max 3 cycles)',
        condition: (context) => {
          const cycles = context.reviewCycles ?? 0;
          return context.approved === true || cycles >= 3;
        },
        onSuccess: 'step-6',
        onFailure: 'step-2',
      },
      {
        id: 'step-6',
        type: 'human_approval',
        description: 'User approves final delivery',
        onSuccess: 'step-7',
        onFailure: 'abort',
      },
      {
        id: 'step-7',
        type: 'update_status',
        description: 'Mark task as done',
        statusUpdate: 'done',
        onSuccess: '__end__',
      },
    ],
  };
}
