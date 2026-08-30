import {
  AllowAllMesaPolicyEngine,
  RoleBasedPolicyEngine,
  createRoomStore,
  createWorkspacePaths,
  FileEventStore,
  FileStorageAdapter,
  isWorkspaceInitialized,
  listAgents,
  loadConfig,
  validateEventLog,
} from '@agentmesa/core';
import type {
  MesaActor,
  MesaConfig,
  MesaRuntimeContext,
  MesaStorageAdapter,
  MesaWorkspacePaths,
} from '@agentmesa/core';
import type { MesaAgent } from '@agentmesa/protocol';
import { currentProtocolVersion, supportedProtocolVersions } from '@agentmesa/protocol';
import { getSetupStatus } from '@agentmesa/setup';
import type { ExecFn } from '@agentmesa/setup';
import type { ParsedArgs } from '../parse-args.js';
import { printError, printInfo, printSuccess, printWarning, outputResult } from '../output.js';

/**
 * `mesa doctor --as-agent` — agent-perspective self-check.
 *
 * Answers the question an AI agent asks itself while debugging collaboration
 * setup: "Am I registered? Are my permissions enough? Can I post, request
 * reviews, and run checks?" Every check is strictly read-only — the command
 * never writes to the workspace, the global mesa home, or the room store.
 */

export type AgentCheckStatus = 'pass' | 'warn' | 'fail';

export type AgentCheckGroup =
  | 'workspace'
  | 'identity'
  | 'rooms'
  | 'permissions'
  | 'mcp'
  | 'events';

export interface AgentCheckResult {
  group: AgentCheckGroup;
  name: string;
  status: AgentCheckStatus;
  message: string;
  detail?: Record<string, unknown>;
  recommendation?: string;
}

export interface AgentSelfCheckReport {
  mode: 'as-agent';
  actor: {
    id: string;
    agentId: string;
    source: 'flag' | 'env' | 'none';
  };
  checks: AgentCheckResult[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
  };
}

export interface DoctorAgentOptions {
  /** Environment override (defaults to process.env) — used for actor + HTTP config resolution. */
  env?: Record<string, string | undefined>;
  /** Injectable process runner for CLI probes (defaults to real spawn; tests substitute). */
  exec?: ExecFn;
}

/** Capability probes: the collaboration verbs an agent needs day-to-day. */
const CAPABILITY_PROBES: Array<{ label: string; action: string; resource: string }> = [
  { label: 'post task message', action: 'message.append', resource: 'message' },
  { label: 'post room message', action: 'room.message.append', resource: 'room' },
  { label: 'request review / submit review result', action: 'handoff.write', resource: 'handoff' },
  { label: 'submit check result', action: 'check.create', resource: 'check' },
  { label: 'create agent run', action: 'run.create', resource: 'run' },
  { label: 'update task status', action: 'task.updateStatus', resource: 'task' },
  { label: 'create task', action: 'task.create', resource: 'task' },
  { label: 'create artifact', action: 'artifact.create', resource: 'artifact' },
  { label: 'invite room member', action: 'room.invite', resource: 'room' },
  { label: 'read events', action: 'event.read', resource: 'events' },
  { label: 'read projections', action: 'projection.read', resource: 'projections' },
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function runDoctorAsAgent(args: ParsedArgs, options?: DoctorAgentOptions): void {
  const json = !!args.flags['json'];
  const report = collectAgentSelfCheck(args, options);

  if (json) {
    outputResult(report, true);
  } else {
    renderReport(report);
  }

  if (report.summary.fail > 0) {
    process.exitCode = 1;
  }
}

export function collectAgentSelfCheck(
  args: ParsedArgs,
  options?: DoctorAgentOptions,
): AgentSelfCheckReport {
  const rootDir = process.cwd();
  const env = options?.env ?? process.env;
  const checks: AgentCheckResult[] = [];

  // --- Actor resolution: --actor flag, then AGENTMESA_MCP_ACTOR_ID env ---
  const flagActor = typeof args.flags['actor'] === 'string' ? args.flags['actor'].trim() : '';
  const envActor = (env['AGENTMESA_MCP_ACTOR_ID'] ?? '').trim();
  const actorId = flagActor || envActor;
  const source: 'flag' | 'env' | 'none' = flagActor ? 'flag' : envActor ? 'env' : 'none';
  // Actor ids look like "agent:codex"; the agent registry keys on the bare id.
  const agentId = actorId.includes(':') ? actorId.slice(actorId.indexOf(':') + 1) : actorId;

  // --- Group 1: workspace ---
  let config: MesaConfig | null = null;
  let paths: MesaWorkspacePaths | null = null;
  if (isWorkspaceInitialized(rootDir)) {
    checks.push({
      group: 'workspace',
      name: 'workspace-initialized',
      status: 'pass',
      message: '.agentmesa/ workspace found with config.json.',
    });
    paths = createWorkspacePaths(rootDir);
    try {
      config = loadConfig(rootDir);
      checks.push({
        group: 'workspace',
        name: 'config-parseable',
        status: 'pass',
        message: `config.json parsed (protocol ${config.protocolVersion}).`,
      });
    } catch (err) {
      checks.push({
        group: 'workspace',
        name: 'config-parseable',
        status: 'fail',
        message: `config.json could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'Fix or regenerate .agentmesa/config.json (mesa init on a fresh directory shows the expected shape).',
      });
    }
  } else {
    checks.push({
      group: 'workspace',
      name: 'workspace-initialized',
      status: 'fail',
      message: `No AgentMesa workspace found at ${rootDir} (.agentmesa/config.json missing).`,
      recommendation: 'Run "mesa init" in the project root, or set AGENTMESA_WORKSPACE to the initialized workspace root.',
    });
  }

  if (config) {
    if (config.protocolVersion === currentProtocolVersion) {
      checks.push({
        group: 'workspace',
        name: 'protocol-version',
        status: 'pass',
        message: `Protocol version ${config.protocolVersion} matches the runtime (${currentProtocolVersion}).`,
      });
    } else if ((supportedProtocolVersions as readonly string[]).includes(config.protocolVersion)) {
      checks.push({
        group: 'workspace',
        name: 'protocol-version',
        status: 'warn',
        message: `Workspace protocol ${config.protocolVersion} is older than the runtime (${currentProtocolVersion}) — migration is supported.`,
        recommendation: 'Regenerate projections after upgrading ("mesa rebuild") so persisted objects carry the current protocol version.',
      });
    } else {
      checks.push({
        group: 'workspace',
        name: 'protocol-version',
        status: 'fail',
        message: `Workspace protocol ${config.protocolVersion} is not understood by this runtime (supports: ${supportedProtocolVersions.join(', ')}).`,
        recommendation: 'Upgrade the @agentmesa packages, or re-init the workspace with the current runtime.',
      });
    }

    if (config.policy?.mode === 'role-based') {
      checks.push({
        group: 'workspace',
        name: 'policy-mode',
        status: 'pass',
        message: 'Policy mode is role-based — permission results below reflect the capability matrix.',
      });
    } else {
      checks.push({
        group: 'workspace',
        name: 'policy-mode',
        status: 'warn',
        message: `Policy mode is "${config.policy?.mode ?? 'default (allow-all)'}" — every action below will be reported as allowed.`,
        recommendation: 'Set policy.mode to "role-based" in .agentmesa/config.json for meaningful permission checks.',
      });
    }
  }

  // --- Group 2: identity registration ---
  let registered: MesaAgent | undefined;
  let actorRoles: MesaActor['roles'] | undefined;
  if (source === 'none') {
    checks.push({
      group: 'identity',
      name: 'actor-id-resolvable',
      status: 'fail',
      message: 'No actor id given and AGENTMESA_MCP_ACTOR_ID is not set — cannot determine who "I" am.',
      recommendation: 'Pass --actor <id> (e.g. --actor agent:codex) or set AGENTMESA_MCP_ACTOR_ID for the MCP server.',
    });
  }

  if (paths && config) {
    const ctx = buildReadOnlyContext(rootDir, paths, config, {
      id: actorId || 'agent:unknown',
      type: 'agent',
      roles: [],
    });
    try {
      const agents = listAgents(ctx);
      registered = agents.find((a) => a.id === agentId);
      if (!agentId) {
        checks.push({
          group: 'identity',
          name: 'agent-registered',
          status: 'fail',
          message: 'Cannot look up agent registration without an actor id.',
          recommendation: 'Pass --actor <id> or set AGENTMESA_MCP_ACTOR_ID.',
        });
      } else if (registered) {
        checks.push({
          group: 'identity',
          name: 'agent-registered',
          status: 'pass',
          message: `Agent "${registered.id}" (${registered.name}) is registered with roles: ${registered.roles.join(', ')}.`,
          detail: { agent: { id: registered.id, name: registered.name, roles: registered.roles, client: registered.client } },
        });
        actorRoles = registered.roles;
      } else {
        checks.push({
          group: 'identity',
          name: 'agent-registered',
          status: 'fail',
          message: `Agent "${agentId}" is not in the agent registry (${agents.length} agent(s) registered).`,
          detail: { registeredAgents: agents.map((a) => a.id) },
          recommendation: `Register it: mesa agent add ${agentId} "<display name>" <roles...>  (or mesa_register_remote_member over MCP).`,
        });
      }
    } catch (err) {
      checks.push({
        group: 'identity',
        name: 'agent-registered',
        status: 'fail',
        message: `Failed to read the agent registry: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'Check .agentmesa/agents/ for corrupted JSON files.',
      });
    }

    // Role drift: env-pinned roles vs registered roles.
    const envRoles = (env['AGENTMESA_MCP_ACTOR_ROLES'] ?? '').trim();
    if (registered && envRoles) {
      const registeredRoles = registered.roles;
      const envList = envRoles.split(',').map((r) => r.trim()).filter(Boolean);
      const missing = registeredRoles.filter((r) => !envList.includes(r));
      const extra = envList.filter((r) => !registeredRoles.includes(r as MesaAgent['roles'][number]));
      if (missing.length === 0 && extra.length === 0) {
        checks.push({
          group: 'identity',
          name: 'role-drift',
          status: 'pass',
          message: `AGENTMESA_MCP_ACTOR_ROLES matches the registered roles (${envList.join(', ')}).`,
        });
      } else {
        const parts: string[] = [];
        if (missing.length > 0) parts.push(`registered but not granted via env: ${missing.join(', ')}`);
        if (extra.length > 0) parts.push(`granted via env but not registered: ${extra.join(', ')}`);
        checks.push({
          group: 'identity',
          name: 'role-drift',
          status: 'warn',
          message: `Role drift between registry and AGENTMESA_MCP_ACTOR_ROLES — ${parts.join('; ')}.`,
          detail: { registeredRoles, envRoles: envList },
          recommendation: 'Align AGENTMESA_MCP_ACTOR_ROLES with the registered roles (re-run mesa plugin install) so policy decisions match the registry.',
        });
      }
    }
  }

  // --- Group 3: room membership ---
  if (agentId) {
    try {
      const rooms = createRoomStore().listRoomsForMember(agentId);
      if (rooms.length > 0) {
        checks.push({
          group: 'rooms',
          name: 'room-membership',
          status: 'pass',
          message: `Member of ${rooms.length} room(s): ${rooms.map((r) => r.room.name).join(', ')}.`,
          detail: {
            rooms: rooms.map((r) => ({
              id: r.room.id,
              name: r.room.name,
              members: r.room.members.length,
              lastMessageAt: r.lastMessageAt,
            })),
          },
        });
      } else {
        checks.push({
          group: 'rooms',
          name: 'room-membership',
          status: 'warn',
          message: `Agent "${agentId}" is not a member of any room — room chat is unavailable.`,
          recommendation: 'Ask an owner to invite you (mesa_invite_to_room), or create a room via mesa_create_room and get invited.',
        });
      }
    } catch (err) {
      checks.push({
        group: 'rooms',
        name: 'room-membership',
        status: 'fail',
        message: `Failed to read the room store: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'Check the global mesa home (AGENTMESA_HOME) rooms/ directory for corrupted files.',
      });
    }
  }

  // --- Group 4: permission capabilities ---
  if (actorRoles === undefined) {
    if (agentId) {
      const envRoles = (env['AGENTMESA_MCP_ACTOR_ROLES'] ?? '').trim();
      if (envRoles) {
        actorRoles = envRoles.split(',').map((r) => r.trim()).filter(Boolean) as MesaActor['roles'];
        checks.push({
          group: 'permissions',
          name: 'role-source',
          status: 'warn',
          message: `Roles resolved from AGENTMESA_MCP_ACTOR_ROLES (${actorRoles.join(', ')}) — the agent is not registered, so these are unverified.`,
        });
      }
    }
  }
  if (actorRoles === undefined || actorRoles.length === 0) {
    checks.push({
      group: 'permissions',
      name: 'capability-matrix',
      status: 'fail',
      message: 'Cannot determine the actor\'s roles — capability matrix check skipped.',
      recommendation: 'Register the agent (mesa agent add) or set AGENTMESA_MCP_ACTOR_ROLES, then re-run.',
    });
  } else if (paths && config) {
    const actor: MesaActor = { id: actorId || 'agent:unknown', type: 'agent', roles: actorRoles };
    const ctx = buildReadOnlyContext(rootDir, paths, config, actor);
    const allowed: Array<{ label: string; action: string }> = [];
    const denied: Array<{ label: string; action: string; reason: string }> = [];
    for (const probe of CAPABILITY_PROBES) {
      const decision = ctx.policy.can(actor, probe.action, probe.resource);
      if (decision.allowed) {
        allowed.push({ label: probe.label, action: probe.action });
      } else {
        denied.push({ label: probe.label, action: probe.action, reason: decision.reason ?? 'denied by policy' });
      }
    }
    // Core collaboration verbs — an agent that cannot do any of these cannot
    // participate meaningfully.
    const coreActions = ['message.append', 'room.message.append'];
    const coreDenied = denied.filter((d) => coreActions.includes(d.action));
    checks.push({
      group: 'permissions',
      name: 'capability-matrix',
      status: coreDenied.length === coreActions.length ? 'fail' : denied.length > 0 ? 'warn' : 'pass',
      message:
        coreDenied.length === coreActions.length
          ? `Roles [${actorRoles.join(', ')}] cannot post any messages — the agent cannot participate.`
          : denied.length > 0
            ? `Roles [${actorRoles.join(', ')}]: ${allowed.length} of ${CAPABILITY_PROBES.length} probed operations allowed; ${denied.length} denied.`
            : `Roles [${actorRoles.join(', ')}]: all ${CAPABILITY_PROBES.length} probed operations allowed.`,
      detail: { allowed, denied },
      recommendation:
        coreDenied.length === coreActions.length
          ? 'Add a role with post_message capability (e.g. builder) to this agent.'
          : denied.length > 0
            ? 'Denied operations are role limits, not setup errors. Add roles (mesa agent add / re-register) if an operation is required.'
            : undefined,
    });
    if (actorRoles.includes('reviewer')) {
      checks.push({
        group: 'permissions',
        name: 'reviewer-status-gate',
        status: 'pass',
        message: 'Reviewer role detected: task status transitions are limited to "approved" and "changes_requested" (unless another role grants change_status).',
      });
    }
  }

  // --- Group 5: MCP channel (config only — never starts a server) ---
  try {
    const setup = getSetupStatus(rootDir, options?.exec);
    const installedSides = (['claude', 'codex'] as const).filter(
      (side) => setup[side].cliAvailable && setup[side].mcpInstalled,
    );
    if (installedSides.length > 0) {
      checks.push({
        group: 'mcp',
        name: 'stdio-registration',
        status: 'pass',
        message: `agentmesa MCP registered with: ${installedSides.join(', ')} (stdio).`,
      });
    } else {
      const unavailable = (['claude', 'codex'] as const)
        .filter((side) => !setup[side].cliAvailable)
        .join(', ');
      checks.push({
        group: 'mcp',
        name: 'stdio-registration',
        status: 'warn',
        message: `agentmesa MCP is not registered with any CLI${unavailable ? ` (CLIs not on PATH: ${unavailable})` : ''}.`,
        recommendation: 'Run "mesa plugin install <claude|codex>" to register the stdio MCP server.',
      });
    }
  } catch (err) {
    checks.push({
      group: 'mcp',
      name: 'stdio-registration',
      status: 'warn',
      message: `Could not probe CLI MCP registrations: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (envActor) {
    checks.push({
      group: 'mcp',
      name: 'stdio-actor-binding',
      status: 'pass',
      message: `AGENTMESA_MCP_ACTOR_ID is set — the stdio MCP server runs as "${envActor}".`,
    });
  } else {
    checks.push({
      group: 'mcp',
      name: 'stdio-actor-binding',
      status: 'warn',
      message: 'AGENTMESA_MCP_ACTOR_ID is not set in this environment — a stdio MCP server would run as the default "agent:mcp" (builder).',
      recommendation: `Re-run "mesa plugin install" or set AGENTMESA_MCP_ACTOR_ID=${actorId || 'agent:<id>'} in the MCP server environment.`,
    });
  }

  const transport = (env['AGENTMESA_MCP_TRANSPORT'] ?? 'stdio').trim().toLowerCase();
  if (transport === 'http') {
    const host = (env['AGENTMESA_HTTP_HOST'] ?? '127.0.0.1').trim();
    if (LOOPBACK_HOSTS.has(host)) {
      checks.push({
        group: 'mcp',
        name: 'http-transport',
        status: 'pass',
        message: `HTTP transport configured on loopback host ${host}.`,
      });
    } else {
      checks.push({
        group: 'mcp',
        name: 'http-transport',
        status: 'warn',
        message: `HTTP transport binds non-loopback host ${host} — remote connections can reach this AgentMesa instance.`,
        recommendation: 'Bind AGENTMESA_HTTP_HOST to 127.0.0.1 unless remote agents genuinely need access.',
      });
    }
    const token = (env['AGENTMESA_HTTP_TOKEN'] ?? '').trim();
    if (token) {
      checks.push({
        group: 'mcp',
        name: 'http-auth-token',
        status: 'pass',
        message: 'AGENTMESA_HTTP_TOKEN is set — HTTP connections require bearer auth.',
      });
    } else {
      checks.push({
        group: 'mcp',
        name: 'http-auth-token',
        status: 'warn',
        message: 'HTTP transport is enabled without AGENTMESA_HTTP_TOKEN — any local process can connect and impersonate any actor id.',
        recommendation: 'Set AGENTMESA_HTTP_TOKEN and share it with connecting agents.',
      });
    }
    const portRaw = (env['AGENTMESA_HTTP_PORT'] ?? '8765').trim();
    const port = Number(portRaw);
    if (Number.isInteger(port) && port >= 0 && port <= 65535) {
      checks.push({
        group: 'mcp',
        name: 'http-port',
        status: 'pass',
        message: `HTTP port ${port} is valid.`,
      });
    } else {
      checks.push({
        group: 'mcp',
        name: 'http-port',
        status: 'fail',
        message: `AGENTMESA_HTTP_PORT "${portRaw}" is not a valid port (expected integer in [0, 65535]).`,
        recommendation: 'Fix AGENTMESA_HTTP_PORT — the MCP server will refuse to start in HTTP mode.',
      });
    }
  } else if (transport === 'stdio') {
    checks.push({
      group: 'mcp',
      name: 'http-transport',
      status: 'pass',
      message: 'Transport is stdio (default) — no HTTP server is configured; AGENTMESA_HTTP_* settings are not used.',
    });
  } else {
    checks.push({
      group: 'mcp',
      name: 'http-transport',
      status: 'warn',
      message: `AGENTMESA_MCP_TRANSPORT "${transport}" is invalid — expected "stdio" or "http".`,
      recommendation: 'Fix AGENTMESA_MCP_TRANSPORT; the MCP server will refuse to start.',
    });
  }

  // --- Group 6: event stream health ---
  if (paths) {
    const logFindings = validateEventLog(paths.eventsDir);
    for (const f of logFindings) {
      checks.push({
        group: 'events',
        name: 'event-log',
        status: f.level === 'error' ? 'fail' : f.level === 'warn' ? 'warn' : 'pass',
        message: f.message,
        ...(f.recommendation ? { recommendation: f.recommendation } : {}),
      });
    }

    // Cursor continuity: per-stream sequence numbers must be contiguous 0..n-1.
    try {
      const ctx = buildReadOnlyContext(
        rootDir,
        paths,
        config ?? { protocolVersion: currentProtocolVersion },
        { id: 'system:doctor-agent', type: 'system', roles: ['read_only'] },
      );
      const events = ctx.eventStore.list();
      const byStream = new Map<string, number[]>();
      for (const e of events) {
        const list = byStream.get(e.streamId) ?? [];
        list.push(e.sequence);
        byStream.set(e.streamId, list);
      }
      const problems: Array<{ streamId: string; expected: number; actual: number }> = [];
      for (const [streamId, sequences] of byStream) {
        const sorted = [...sequences].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] !== i) {
            problems.push({ streamId, expected: i, actual: sorted[i]! });
            break;
          }
        }
      }
      if (events.length === 0) {
        checks.push({
          group: 'events',
          name: 'event-cursor-continuity',
          status: 'pass',
          message: 'No events yet — cursor continuity trivially holds.',
        });
      } else if (problems.length === 0) {
        checks.push({
          group: 'events',
          name: 'event-cursor-continuity',
          status: 'pass',
          message: `Event cursor continuity holds: ${events.length} event(s) across ${byStream.size} stream(s), sequences contiguous per stream.`,
        });
      } else {
        checks.push({
          group: 'events',
          name: 'event-cursor-continuity',
          status: 'fail',
          message: `Event sequence gaps/duplicates in ${problems.length} stream(s): ${problems.map((p) => `${p.streamId} (expected ${p.expected}, got ${p.actual})`).join('; ')}.`,
          detail: { problems },
          recommendation: 'Cursor-based incremental reads (events, rooms) may skip or duplicate events. Inspect .agentmesa/events/events.jsonl.',
        });
      }
    } catch (err) {
      checks.push({
        group: 'events',
        name: 'event-cursor-continuity',
        status: 'fail',
        message: `Failed to read the event log for continuity check: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'Inspect .agentmesa/events/events.jsonl for corrupted lines.',
      });
    }
  }

  const summary = {
    total: checks.length,
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  return {
    mode: 'as-agent',
    actor: { id: actorId, agentId, source },
    checks,
    summary,
  };
}

/**
 * Build a runtime context that is guaranteed read-only: directory creation is
 * a no-op and any write attempt throws. Self-checks must never mutate the
 * workspace they are inspecting.
 */
function buildReadOnlyContext(
  rootDir: string,
  paths: MesaWorkspacePaths,
  config: MesaConfig,
  actor: MesaActor,
): MesaRuntimeContext {
  const base = new FileStorageAdapter();
  const storage: MesaStorageAdapter = {
    readText: (path) => base.readText(path),
    writeText: (path) => {
      throw new Error(`doctor --as-agent is read-only: refused to write ${path}`);
    },
    delete: (path) => {
      throw new Error(`doctor --as-agent is read-only: refused to delete ${path}`);
    },
    exists: (path) => base.exists(path),
    list: (path) => base.list(path),
    ensureDirectory: () => {
      /* no-op: read-only checks never create directories */
    },
  };
  return {
    rootDir,
    paths,
    config,
    actor,
    storage,
    eventStore: new FileEventStore(paths.eventsDir),
    policy:
      config.policy?.mode === 'role-based'
        ? new RoleBasedPolicyEngine()
        : new AllowAllMesaPolicyEngine(),
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    transports: [],
  };
}

const GROUP_ORDER: AgentCheckGroup[] = ['workspace', 'identity', 'rooms', 'permissions', 'mcp', 'events'];

const GROUP_LABELS: Record<AgentCheckGroup, string> = {
  workspace: 'Workspace',
  identity: 'Identity registration',
  rooms: 'Room membership',
  permissions: 'Permissions & capabilities',
  mcp: 'MCP channel',
  events: 'Event stream health',
};

function renderReport(report: AgentSelfCheckReport): void {
  console.log('AgentMesa Doctor — Agent Self-Check');
  console.log('==================================');
  const actorLine = report.actor.source === 'none'
    ? '(unresolved — pass --actor or set AGENTMESA_MCP_ACTOR_ID)'
    : `${report.actor.id} (source: ${report.actor.source === 'flag' ? '--actor flag' : 'AGENTMESA_MCP_ACTOR_ID env'})`;
  console.log(`Actor: ${actorLine}`);
  console.log('');

  for (const group of GROUP_ORDER) {
    const groupChecks = report.checks.filter((c) => c.group === group);
    if (groupChecks.length === 0) continue;
    console.log(`[${GROUP_LABELS[group]}]`);
    for (const c of groupChecks) {
      const line = `${c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'FAIL'}  ${c.name}: ${c.message}`;
      if (c.status === 'fail') {
        printError(line);
      } else if (c.status === 'warn') {
        printWarning(line);
      } else {
        printSuccess(line);
      }
      if (c.recommendation) {
        printInfo(`      fix: ${c.recommendation}`);
      }
    }
    console.log('');
  }

  const { pass, warn, fail } = report.summary;
  if (fail === 0 && warn === 0) {
    printSuccess(`All ${pass} self-check(s) passed.`);
  } else if (fail === 0) {
    printWarning(`${pass} passed, ${warn} warning(s).`);
  } else {
    printError(`FAIL — ${fail} failing, ${warn} warning(s), ${pass} passed.`);
  }
}
