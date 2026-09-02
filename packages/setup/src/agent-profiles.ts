import { MesaError, listAgents, registerAgent } from '@agentmesa/core';
import type { MesaRuntimeContext } from '@agentmesa/core';
import type { AgentRole } from '@agentmesa/protocol';
import { installMcpIntegration, installProjectFiles } from './setup.js';
import type { ExecFn, IntegrationSide } from './setup.js';

/** Host CLI the profile wires up — mirrors the protocol ClientType values. */
export type ProfileClient = 'claude-code' | 'codex';

/**
 * Declarative bundle for one external agent: the registry entry plus the
 * project-side integration files, so `mesa agent install <name>` yields a
 * configured agent without manual steps. AgentMesa stays a pure orchestrator —
 * the intelligence still lives in the host CLI.
 */
export interface AgentProfile {
  /** Profile name used on the CLI: `mesa agent install <name>`. */
  name: string;
  agentId: string;
  agentName: string;
  client: ProfileClient;
  /** Mirrors the actorRoles of the side's MCP integration (INTEGRATIONS). */
  roles: AgentRole[];
  integrationSide: IntegrationSide;
}

// Built-in profiles. Roles match INTEGRATIONS actorRoles so the registry
// entry and the MCP actor env vars grant the same authority.
const BUILT_IN_PROFILES: Record<string, AgentProfile> = {
  claude: {
    name: 'claude',
    agentId: 'agent:claude',
    agentName: 'Claude Code',
    client: 'claude-code',
    roles: ['builder'],
    integrationSide: 'claude',
  },
  codex: {
    name: 'codex',
    agentId: 'agent:codex',
    agentName: 'Codex',
    client: 'codex',
    roles: ['reviewer'],
    integrationSide: 'codex',
  },
};

/** All built-in profiles. Third-party profiles can join this registry later. */
export function listAgentProfiles(): AgentProfile[] {
  return Object.values(BUILT_IN_PROFILES);
}

export function resolveAgentProfile(name: string): AgentProfile {
  const profile = BUILT_IN_PROFILES[name];
  if (!profile) {
    const available = Object.keys(BUILT_IN_PROFILES).join(', ');
    throw new MesaError(
      'VALIDATION_ERROR',
      `Unknown agent profile "${name}". Available profiles: ${available}`,
    );
  }
  return profile;
}

export interface AgentProfileInstallOptions {
  /** Target directory for project files; defaults to ctx.rootDir. */
  projectDir?: string;
  /** Also register the agentmesa MCP server with the host CLI (user scope). */
  mcp?: boolean;
  /** Injectable process runner for the MCP step — tests substitute a recorder. */
  exec?: ExecFn;
}

export interface AgentProfileInstallResult {
  profile: string;
  agentId: string;
  /** True when this call created the registry entry; false when it existed. */
  registered: boolean;
  filesWritten: string[];
  mcpInstalled: boolean;
  /** Failure output of the MCP registration step, when attempted and failed. */
  mcpError?: string;
}

/**
 * Install a profile end to end: register the agent, write the project files,
 * and optionally wire up the user-level MCP integration. Idempotent —
 * reinstalling keeps the existing registry entry and rewrites the same files.
 */
export function installAgentProfile(
  ctx: MesaRuntimeContext,
  profileName: string,
  options: AgentProfileInstallOptions = {},
): AgentProfileInstallResult {
  const profile = resolveAgentProfile(profileName);

  // registerAgent overwrites silently, so detect an existing entry first to
  // keep reinstalls non-destructive and report what happened.
  const registered = !listAgents(ctx).some((agent) => agent.id === profile.agentId);
  if (registered) {
    registerAgent(ctx, {
      id: profile.agentId,
      name: profile.agentName,
      client: profile.client,
      status: 'available',
      roles: profile.roles,
    });
  }

  const project = installProjectFiles(profile.integrationSide, options.projectDir ?? ctx.rootDir);

  let mcpInstalled = false;
  let mcpError: string | undefined;
  if (options.mcp) {
    const result = installMcpIntegration(profile.integrationSide, options.exec);
    if (result.ok) {
      mcpInstalled = true;
    } else {
      mcpError = `${result.output} (command: ${result.command})`;
    }
  }

  return {
    profile: profile.name,
    agentId: profile.agentId,
    registered,
    filesWritten: project.filesWritten,
    mcpInstalled,
    ...(mcpError !== undefined ? { mcpError } : {}),
  };
}
