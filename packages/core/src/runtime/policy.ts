import type {
  MesaActor,
  MesaPolicyDecision,
  MesaPolicyEngine,
} from './types.js';

// --- Allow-all (development / bootstrapping default) ---

export class AllowAllMesaPolicyEngine implements MesaPolicyEngine {
  can(_actor: MesaActor, _action: string, _resource: string): MesaPolicyDecision {
    return { allowed: true };
  }

  canWithContext(
    _actor: MesaActor,
    _action: string,
    _resource: string,
    _context?: Record<string, unknown>,
  ): MesaPolicyDecision {
    return { allowed: true };
  }
}

// --- Role-based policy engine ---

type Capability =
  | 'read_task'
  | 'write_task'
  | 'change_status'
  | 'post_message'
  | 'create_artifact'
  | 'archive_task'
  | 'delete_task'
  | 'manage_agents'
  | 'manage_meetings'
  | 'read_events'
  | 'read_projections'
  | 'rebuild_projections'
  | 'inspect_transports';

/**
 * Maps core service action keys to the least-privilege capability required.
 * Unmapped actions are denied by default.
 */
const ACTION_CAPABILITY: Record<string, Capability> = {
  'task.create': 'write_task',
  'task.updateStatus': 'change_status',
  'task.assign': 'write_task',
  'task.archive': 'archive_task',
  'task.delete': 'delete_task',
  'meeting.create': 'manage_meetings',
  'meeting.updateStatus': 'manage_meetings',
  'meeting.addTask': 'manage_meetings',
  'meeting.addAgent': 'manage_meetings',
  'message.append': 'post_message',
  'artifact.create': 'create_artifact',
  'agent.register': 'manage_agents',
  'event.read': 'read_events',
  'projection.read': 'read_projections',
  'projection.rebuild': 'rebuild_projections',
  'transport.inspect': 'inspect_transports',
};

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  owner: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'archive_task',
    'delete_task',
    'manage_agents',
    'manage_meetings',
    'read_events',
    'read_projections',
    'rebuild_projections',
    'inspect_transports',
  ],
  admin: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'archive_task',
    'delete_task',
    'manage_agents',
    'manage_meetings',
    'read_events',
    'read_projections',
    'rebuild_projections',
    'inspect_transports',
  ],
  builder: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  reviewer: [
    'read_task',
    'change_status',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  connector: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  ci: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  system: [
    'read_task',
    'read_events',
    'read_projections',
    'rebuild_projections',
  ],
  // --- legacy roles (kept for backward compat) ---
  chair: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'archive_task',
    'delete_task',
    'manage_agents',
    'manage_meetings',
    'read_events',
    'read_projections',
    'rebuild_projections',
    'inspect_transports',
  ],
  planner: [
    'read_task',
    'write_task',
    'post_message',
    'manage_meetings',
    'read_events',
    'read_projections',
  ],
  tester: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  documenter: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  maintainer: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'archive_task',
    'delete_task',
    'manage_agents',
    'manage_meetings',
    'read_events',
    'read_projections',
    'rebuild_projections',
    'inspect_transports',
  ],
  researcher: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
  ],
  custom: ['read_task'],
};

export class RoleBasedPolicyEngine implements MesaPolicyEngine {
  private readonly capabilities: Record<string, Set<Capability>>;

  constructor(overrides?: Record<string, Capability[]>) {
    this.capabilities = {};
    const base = { ...ROLE_CAPABILITIES, ...overrides };
    for (const [role, caps] of Object.entries(base)) {
      this.capabilities[role] = new Set(caps);
    }
  }

  can(actor: MesaActor, action: string, _resource: string): MesaPolicyDecision {
    return this.canWithContext(actor, action, _resource);
  }

  canWithContext(
    actor: MesaActor,
    action: string,
    _resource: string,
    _context?: Record<string, unknown>,
  ): MesaPolicyDecision {
    // Owner bypass — full access for workspace owners
    if (actor.roles.includes('owner')) {
      return { allowed: true };
    }

    const requiredCap = ACTION_CAPABILITY[action];
    if (!requiredCap) {
      return {
        allowed: false,
        reason: `Unknown action "${action}" — no capability mapping exists`,
      };
    }

    // Before checking capability: enforce context-sensitive reviewer status limit.
    // Reviewer may only transition task status to "approved" or "changes_requested".
    // This is checked before the capability gate so the deny reason is specific.
    if (
      action === 'task.updateStatus' &&
      actor.roles.includes('reviewer') &&
      !actor.roles.includes('admin') &&
      !actor.roles.includes('maintainer')
    ) {
      const targetStatus = _context?.targetStatus as string | undefined;
      if (!targetStatus || !['approved', 'changes_requested'].includes(targetStatus)) {
        return {
          allowed: false,
          reason: `Reviewer may only transition status to "approved" or "changes_requested", not "${targetStatus ?? 'unknown'}"`,
        };
      }
    }

    for (const role of actor.roles) {
      const roleCaps = this.capabilities[role];
      if (roleCaps?.has(requiredCap)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Actor ${actor.id} (roles: ${actor.roles.join(', ')}) lacks capability "${requiredCap}" for action "${action}"`,
    };
  }
}
