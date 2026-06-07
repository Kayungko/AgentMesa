import { MesaError } from '@agentmesa/core';
import type { AgentRole } from '@agentmesa/protocol';
import type { PolicyAction, RoleCapability } from './types.js';
import { defineRoleCapabilities } from './role-capabilities.js';

export class PolicyError extends MesaError {
  constructor(role: AgentRole, action: PolicyAction) {
    super(
      'VALIDATION_ERROR',
      `Role "${role}" is not authorized to perform action "${action}"`,
    );
    this.name = 'PolicyError';
  }
}

export class PermissionChecker {
  private readonly capabilities: RoleCapability;

  constructor(capabilities?: RoleCapability) {
    this.capabilities = capabilities ?? defineRoleCapabilities();
  }

  canPerform(role: AgentRole, action: PolicyAction): boolean {
    const actions = this.capabilities[role];
    if (!actions) return false;
    return actions.includes(action);
  }

  assertCanPerform(role: AgentRole, action: PolicyAction): void {
    if (!this.canPerform(role, action)) {
      throw new PolicyError(role, action);
    }
  }

  getActions(role: AgentRole): PolicyAction[] {
    return this.capabilities[role] ?? [];
  }

  getRolesForAction(action: PolicyAction): AgentRole[] {
    const roles: AgentRole[] = [];
    for (const [role, actions] of Object.entries(this.capabilities)) {
      if (actions.includes(action)) {
        roles.push(role as AgentRole);
      }
    }
    return roles;
  }
}
