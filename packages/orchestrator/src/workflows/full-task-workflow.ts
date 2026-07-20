import type { WorkflowDefinition } from '../types.js';

/**
 * Defines a comprehensive task workflow:
 * plan -> implement -> review -> test -> document -> approve -> done
 */
export function defineFullTaskWorkflow(): WorkflowDefinition {
  return {
    id: 'full-task-workflow',
    name: 'Full Task Workflow',
    description: 'Comprehensive workflow: plan, implement, review, test, document, approve, done',
    startStep: 'step-plan',
    steps: [
      {
        id: 'step-plan',
        type: 'run_agent',
        runnerType: 'plan',
        agentId: 'planner',
        description: 'Planner creates implementation plan',
        onSuccess: 'step-start',
        onFailure: 'abort',
      },
      {
        id: 'step-start',
        type: 'update_status',
        description: 'Mark task as in_progress',
        statusUpdate: 'in_progress',
        onSuccess: 'step-implement',
      },
      {
        id: 'step-implement',
        type: 'run_agent',
        runnerType: 'implement',
        agentId: 'builder',
        description: 'Builder implements the task',
        onSuccess: 'step-ready-for-review',
        onFailure: 'abort',
      },
      {
        id: 'step-ready-for-review',
        type: 'update_status',
        description: 'Mark task as ready_for_review',
        statusUpdate: 'ready_for_review',
        onSuccess: 'step-reviewing',
      },
      {
        id: 'step-reviewing',
        type: 'update_status',
        description: 'Mark task as reviewing',
        statusUpdate: 'reviewing',
        onSuccess: 'step-review',
      },
      {
        id: 'step-review',
        type: 'run_agent',
        runnerType: 'review',
        agentId: 'reviewer',
        description: 'Reviewer reviews the implementation',
        onSuccess: 'step-check-review',
        onFailure: 'step-fix',
      },
      {
        id: 'step-check-review',
        type: 'check',
        description: 'Check if review approved (max 3 cycles)',
        condition: (context) => {
          const cycles = context.reviewCycles ?? 0;
          return context.approved === true || cycles >= 3;
        },
        onSuccess: 'step-ready-for-test',
        onFailure: 'step-fix',
      },
      {
        id: 'step-fix',
        type: 'run_agent',
        runnerType: 'fix',
        agentId: 'builder',
        description: 'Builder fixes issues from review',
        onSuccess: 'step-fix-status',
        onFailure: 'abort',
      },
      {
        id: 'step-fix-status',
        type: 'update_status',
        description: 'Mark task as in_progress after fix',
        statusUpdate: 'in_progress',
        onSuccess: 'step-ready-for-review',
      },
      {
        id: 'step-ready-for-test',
        type: 'update_status',
        description: 'Mark task as approved',
        statusUpdate: 'approved',
        onSuccess: 'step-test',
      },
      {
        id: 'step-test',
        type: 'run_agent',
        runnerType: 'test',
        agentId: 'tester',
        description: 'Tester runs tests',
        onSuccess: 'step-document',
        onFailure: 'step-fix',
      },
      {
        id: 'step-document',
        type: 'run_agent',
        runnerType: 'document',
        agentId: 'documenter',
        description: 'Documenter creates documentation',
        onSuccess: 'step-approve',
        onFailure: 'step-approve',
      },
      {
        id: 'step-approve',
        type: 'human_approval',
        description: 'User approves final delivery',
        onSuccess: 'step-done',
        onFailure: 'abort',
      },
      {
        id: 'step-done',
        type: 'update_status',
        description: 'Mark task as done',
        statusUpdate: 'done',
        onSuccess: '__end__',
      },
    ],
  };
}
