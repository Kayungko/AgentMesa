import { createRuntimeContext } from '@agentmesa/core';
import { WorkflowEngine, getWorkflowDefinition } from '@agentmesa/orchestrator';
import type { WorkflowState } from '@agentmesa/orchestrator';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export async function runWorkflow(args: ParsedArgs): Promise<void> {
  const rootDir = process.cwd();
  const ctx = createRuntimeContext({
    rootDir,
    actor: {
      id: 'system:orchestrator',
      type: 'system',
      roles: ['owner'],
    },
  });
  const json = !!args.flags['json'];
  const engine = new WorkflowEngine(ctx);

  try {
    switch (args.subcommand) {
      case 'start': {
        const taskId = args.positional[0];
        if (!taskId) {
          console.log('Usage: mesa workflow start <taskId> [--definition <id>]');
          return;
        }
        const definitionId = typeof args.flags['definition'] === 'string'
          ? args.flags['definition']
          : 'review-fix-loop';
        const def = getWorkflowDefinition(definitionId);
        let state = engine.startWorkflow(def, taskId);
        state = await engine.advanceWorkflow(state);
        outputResult(state, json, () => printWorkflow(state));
        if (state.status === 'failed') process.exitCode = 1;
        return;
      }

      case 'status': {
        const workflowId = args.positional[0];
        if (!workflowId) {
          console.log('Usage: mesa workflow status <workflowId>');
          return;
        }
        const state = engine.getState(workflowId);
        if (!state) {
          printError(`Workflow ${workflowId} not found`);
          process.exitCode = 1;
          return;
        }
        outputResult(state, json, () => printWorkflow(state, true));
        return;
      }

      case 'approve': {
        const workflowId = args.positional[0];
        if (!workflowId) {
          console.log('Usage: mesa workflow approve <workflowId>');
          return;
        }
        const loaded = engine.getState(workflowId);
        if (!loaded) {
          printError(`Workflow ${workflowId} not found`);
          process.exitCode = 1;
          return;
        }
        let state = engine.approve(loaded);
        state = await engine.advanceWorkflow(state);
        outputResult(state, json, () => printWorkflow(state));
        if (state.status === 'failed') process.exitCode = 1;
        return;
      }

      case 'run': {
        const workflowId = args.positional[0];
        if (!workflowId) {
          console.log('Usage: mesa workflow run <workflowId>');
          return;
        }
        const loaded = engine.getState(workflowId);
        if (!loaded) {
          printError(`Workflow ${workflowId} not found`);
          process.exitCode = 1;
          return;
        }
        const state = await engine.advanceWorkflow(loaded);
        outputResult(state, json, () => printWorkflow(state));
        if (state.status === 'failed') process.exitCode = 1;
        return;
      }

      default:
        console.log('Usage: mesa workflow <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  start <taskId>          Start a workflow for a task (--definition <id>)');
        console.log('  status <workflowId>     Show workflow status and history');
        console.log('  approve <workflowId>    Approve a workflow waiting on human approval');
        console.log('  run <workflowId>        Advance a running workflow');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

function printWorkflow(state: WorkflowState, withHistory = false): void {
  printSuccess(`Workflow ${state.workflowId}`);
  console.log(`  Definition  : ${state.workflowDefinitionId}`);
  console.log(`  Task        : ${state.taskId}`);
  console.log(`  Status      : ${state.status}`);
  console.log(`  Current step: ${state.currentStep}`);
  if (state.context.reviewCycles !== undefined) {
    console.log(`  Review cycles: ${state.context.reviewCycles}`);
  }
  if (withHistory && state.history.length > 0) {
    console.log('  History:');
    for (const h of state.history) {
      const err = h.error ? ` — ${h.error}` : '';
      console.log(`    ${h.stepId.padEnd(24)} ${h.status}${err}`);
    }
  }
  console.log('');
}
