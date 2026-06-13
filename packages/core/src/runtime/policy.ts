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
  | 'manage_meetings';

/**
 * Maps core service action keys (e.g. "task.create") to the least-privilege
 * capability required. Unmapped actions are denied by default.
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
  'message.send': 'post_message',
  'artifact.create': 'create_artifact',
  'agent.register': 'manage_agents',
};

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  chair: [
    'read_task', 'write_task', 'change_status', 'post_message',
    'create_artifact', 'archive_task', 'delete_task', 'manage_agents', 'manage_meetings',
  ],
  planner: [
    'read_task', 'write_task', 'post_message', 'manage_meetings',
  ],
  builder: [
    'read_task', 'write_task', 'change_status', 'post_message', 'create_artifact',
  ],
  reviewer: [
    'read_task', 'change_status', 'post_message', 'create_artifact',
  ],
  tester: [
    'read_task', 'post_message', 'create_artifact',
  ],
  documenter: [
    'read_task', 'post_message', 'create_artifact',
  ],
  maintainer: [
    'read_task', 'write_task', 'change_status', 'post_message',
    'create_artifact', 'archive_task', 'delete_task', 'manage_agents', 'manage_meetings',
  ],
  researcher: [
    'read_task', 'post_message', 'create_artifact',
  ],
  custom: [
    'read_task',
  ],
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
    // Owner / admin bypass — full access for workspace owners
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
