import { MesaError } from '@agentmesa/core';
import type { WorkflowDefinition } from './types.js';
import { defineReviewFixLoop } from './workflows/review-fix-loop.js';
import { defineFullTaskWorkflow } from './workflows/full-task-workflow.js';

const REGISTRY = new Map<string, () => WorkflowDefinition>();

export function registerWorkflow(id: string, factory: () => WorkflowDefinition): void {
  REGISTRY.set(id, factory);
}

export function getWorkflowDefinition(id: string): WorkflowDefinition {
  const factory = REGISTRY.get(id);
  if (!factory) {
    throw new MesaError('VALIDATION_ERROR', `Unknown workflow definition: ${id}`);
  }
  return factory();
}

export function listWorkflowDefinitionIds(): string[] {
  return [...REGISTRY.keys()];
}

registerWorkflow('review-fix-loop', defineReviewFixLoop);
registerWorkflow('full-task-workflow', defineFullTaskWorkflow);
