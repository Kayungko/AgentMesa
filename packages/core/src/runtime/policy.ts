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
  | 'inspect_transports'
  | 'manage_runs';

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
  'run.create': 'manage_runs',
  'run.updateStatus': 'manage_runs',
  'run.read': 'manage_runs',
  'handoff.write': 'manage_runs',
  'handoff.read': 'manage_runs',
  'check.create': 'manage_runs',
  'check.read': 'manage_runs',
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
    'manage_runs',
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
    'manage_runs',
  ],
  builder: [
    'read_task',
    'write_task',
    'change_status',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
    'manage_runs',
    'manage_meetings',
    'manage_agents',
  ],
  reviewer: [
    'read_task',
    'change_status',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
    'manage_runs',
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
    'manage_runs',
  ],
  system: [
    'read_task',
    'read_events',
    'read_projections',
    'rebuild_projections',
  ],
  // Read-only external viewers (e.g. Mesa Desk). Includes manage_runs
  // because run/handoff/check reads share that capability with their write
  // counterparts (coarse-grained by design — see docs/LOCAL_AI_ACTION_PLAN.md
  // Priority 7); read_only actors never call the write-side functions.
  read_only: [
    'read_task',
    'read_events',
    'read_projections',
    'manage_runs',
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
    'manage_runs',
  ],
  planner: [
    'read_task',
    'write_task',
    'post_message',
    'manage_meetings',
    'read_events',
    'read_projections',
    'manage_runs',
  ],
  tester: [
    'read_task',
    'post_message',
    'create_artifact',
    'read_events',
    'read_projections',
    'manage_runs',
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
    'manage_runs',
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

    // Context-sensitive reviewer status limit: a pure reviewer may only
    // transition to "approved" or "changes_requested". When the actor has
    // another role with change_status capability (builder, chair, admin,
    // maintainer, owner), the higher-privilege role wins and the reviewer
    // gate does not apply.
    const hasNonReviewerStatusRole = actor.roles.some(
      role => role !== 'reviewer' && this.capabilities[role]?.has('change_status'),
    );
    if (
      action === 'task.updateStatus' &&
      actor.roles.includes('reviewer') &&
      !hasNonReviewerStatusRole
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
