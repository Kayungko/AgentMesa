import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { loadConfig, WorkspaceNotFoundError } from '@agentmesa/core';
import type { MesaConfig } from '@agentmesa/core';
import { installClaudePlugin } from '@agentmesa/plugin-claude';
import { installCodexPlugin } from '@agentmesa/plugin-codex';

export type IntegrationSide = 'claude' | 'codex';

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Injectable process runner — tests substitute a recorder instead of spawning CLIs. */
export type ExecFn = (command: string, args: string[]) => ExecResult;

export function defaultExec(command: string, args: string[]): ExecResult {
  // On Windows, CLIs installed via npm are .cmd shims that spawnSync cannot
  // resolve without a shell. Quote any argument containing whitespace and run
  // the whole line through cmd. All arguments are built here, never from user
  // input, so the shell adds no injection surface.
  const useShell = process.platform === 'win32';
  const res = useShell
    ? spawnSync(toShellLine(command, args), { shell: true, encoding: 'utf-8', timeout: 60_000 })
    : spawnSync(command, args, { encoding: 'utf-8', timeout: 60_000 });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    ...(res.error ? { error: res.error } : {}),
  };
}

function toShellLine(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');
}

interface IntegrationSpec {
  cli: string;
  actorId: string;
  actorRoles: string;
}

const INTEGRATIONS: Record<IntegrationSide, IntegrationSpec> = {
  claude: { cli: 'claude', actorId: 'agent:claude', actorRoles: 'builder' },
  codex: { cli: 'codex', actorId: 'agent:codex', actorRoles: 'reviewer' },
};

const MCP_SERVER_NAME = 'agentmesa';

export function isIntegrationSide(value: string): value is IntegrationSide {
  return value === 'claude' || value === 'codex';
}

/** Absolute path of the mesa-mcp entry point, resolved from the installed package. */
export function resolveMcpServerBin(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('@agentmesa/mcp-server/bin');
}

export interface SetupSideStatus {
  cliAvailable: boolean;
  mcpInstalled: boolean;
}

export type RunnerSource = 'env' | 'config' | 'stub';

export interface RunnerCommands {
  claudeCmd?: string;
  codexCmd?: string;
}

export interface SetupStatus {
  claude: SetupSideStatus;
  codex: SetupSideStatus;
  runners: RunnerCommands;
  runnerSources: Record<IntegrationSide, RunnerSource>;
}

function probeSide(side: IntegrationSide, exec: ExecFn): SetupSideStatus {
  const { cli } = INTEGRATIONS[side];
  const res = exec(cli, ['mcp', 'get', MCP_SERVER_NAME]);
  const code = (res.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'EINVAL') {
    return { cliAvailable: false, mcpInstalled: false };
  }
  return { cliAvailable: true, mcpInstalled: res.status === 0 };
}

const RUNNER_ENV_KEYS: Record<IntegrationSide, string> = {
  claude: 'AGENTMESA_CLAUDE_CMD',
  codex: 'AGENTMESA_CODEX_CMD',
};

function resolveRunnerSource(side: IntegrationSide, rootDir: string): RunnerSource {
  if (process.env[RUNNER_ENV_KEYS[side]]?.trim()) {
    return 'env';
  }
  const command = getRunnerCommands(rootDir);
  const value = side === 'claude' ? command.claudeCmd : command.codexCmd;
  return value?.trim() ? 'config' : 'stub';
}

export function getSetupStatus(rootDir: string, exec: ExecFn = defaultExec): SetupStatus {
  return {
    claude: probeSide('claude', exec),
    codex: probeSide('codex', exec),
    runners: getRunnerCommands(rootDir),
    runnerSources: {
      claude: resolveRunnerSource('claude', rootDir),
      codex: resolveRunnerSource('codex', rootDir),
    },
  };
}

export interface SetupActionResult {
  side: IntegrationSide;
  ok: boolean;
  command: string;
  output: string;
}

function toActionResult(side: IntegrationSide, argv: string[], res: ExecResult): SetupActionResult {
  const command = [INTEGRATIONS[side].cli, ...argv].join(' ');
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    const hint = code === 'ENOENT'
      ? ` (CLI "${INTEGRATIONS[side].cli}" not found on PATH — install it first)`
      : '';
    return { side, ok: false, command, output: `${res.error.message}${hint}` };
  }
  if (res.status !== 0) {
    return { side, ok: false, command, output: (res.stderr || res.stdout).trim() || `exited with code ${res.status}` };
  }
  return { side, ok: true, command, output: (res.stdout || res.stderr).trim() };
}

/**
 * Register the agentmesa MCP server with a native CLI via its own `mcp add`
 * command, so the CLI owns the config format (~/.claude.json / ~/.codex/config.toml).
 */
export function installMcpIntegration(
  side: IntegrationSide,
  exec: ExecFn = defaultExec,
  workspaceRootDir?: string,
): SetupActionResult {
  const { actorId, actorRoles } = INTEGRATIONS[side];
  const bin = resolveMcpServerBin();
  const workspaceEnv = workspaceRootDir ? [`AGENTMESA_WORKSPACE=${resolve(workspaceRootDir)}`] : [];
  const argv = side === 'claude'
    ? [
        'mcp', 'add', MCP_SERVER_NAME, '-s', 'user',
        '-e', `AGENTMESA_MCP_ACTOR_ID=${actorId}`,
        '-e', `AGENTMESA_MCP_ACTOR_ROLES=${actorRoles}`,
        ...workspaceEnv.map((value) => ['-e', value] as [string, string]).flat(),
        '--', 'node', bin,
      ]
    : [
        'mcp', 'add', MCP_SERVER_NAME,
        '--env', `AGENTMESA_MCP_ACTOR_ID=${actorId}`,
        '--env', `AGENTMESA_MCP_ACTOR_ROLES=${actorRoles}`,
        ...workspaceEnv.map((value) => ['--env', value] as [string, string]).flat(),
        '--', 'node', bin,
      ];
  return toActionResult(side, argv, exec(INTEGRATIONS[side].cli, argv));
}

export function uninstallMcpIntegration(side: IntegrationSide, exec: ExecFn = defaultExec): SetupActionResult {
  const argv = ['mcp', 'remove', MCP_SERVER_NAME];
  return toActionResult(side, argv, exec(INTEGRATIONS[side].cli, argv));
}

function configPath(rootDir: string): string {
  return join(rootDir, '.agentmesa', 'config.json');
}

/** Runner commands persisted in `.agentmesa/config.json`; empty when unset. */
export function getRunnerCommands(rootDir: string): RunnerCommands {
  const path = configPath(rootDir);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const config = JSON.parse(readFileSync(path, 'utf-8')) as MesaConfig;
    return {
      ...(config.runners?.claudeCmd ? { claudeCmd: config.runners.claudeCmd } : {}),
      ...(config.runners?.codexCmd ? { codexCmd: config.runners.codexCmd } : {}),
    };
  } catch {
    return {};
  }
}

export interface RunnerCommandPatch {
  /** New command; `null` clears the stored value. */
  claudeCmd?: string | null;
  /** New command; `null` clears the stored value. */
  codexCmd?: string | null;
}

/** Merge runner commands into the workspace config; returns the stored result. */
export function setRunnerCommands(rootDir: string, patch: RunnerCommandPatch): RunnerCommands {
  const path = configPath(rootDir);
  if (!existsSync(path)) {
    throw new WorkspaceNotFoundError(rootDir);
  }
  const config = loadConfig(rootDir);
  const runners: RunnerCommands = { ...config.runners };

  if (patch.claudeCmd === null) delete runners.claudeCmd;
  else if (typeof patch.claudeCmd === 'string') runners.claudeCmd = patch.claudeCmd;

  if (patch.codexCmd === null) delete runners.codexCmd;
  else if (typeof patch.codexCmd === 'string') runners.codexCmd = patch.codexCmd;

  const next: MesaConfig = { ...config };
  if (runners.claudeCmd || runners.codexCmd) {
    next.runners = runners;
  } else {
    delete next.runners;
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return getRunnerCommands(rootDir);
}

export interface ProjectInstallResult {
  side: IntegrationSide;
  filesWritten: string[];
}

/**
 * Write project-level integration files (CLAUDE.md / AGENTS.md / skills / MCP
 * snippets) into a target directory — the in-repo companion to the user-level
 * `mcp add` registration.
 */
export function installProjectFiles(side: IntegrationSide, dir: string): ProjectInstallResult {
  const bin = resolveMcpServerBin();
  mkdirSync(dir, { recursive: true });

  if (side === 'claude') {
    const result = installClaudePlugin(dir, {
      mcpConfig: {
        mcpServerPath: bin,
        cwd: dir,
        actorId: INTEGRATIONS.claude.actorId,
        actorRoles: INTEGRATIONS.claude.actorRoles,
      },
    });
    const mcpJsonPath = join(dir, '.mcp.json');
    writeFileSync(mcpJsonPath, `${JSON.stringify(result.mcpConfig, null, 2)}\n`, 'utf-8');
    return { side, filesWritten: [...result.filesWritten, ...result.filesAppended, mcpJsonPath] };
  }

  const summary = installCodexPlugin(dir, {
    mcpServerPath: bin,
    mesaDir: dir,
    actorId: INTEGRATIONS.codex.actorId,
    actorRoles: INTEGRATIONS.codex.actorRoles,
  });
  const filesWritten: string[] = [];
  const agentsMdPath = join(dir, 'AGENTS.md');
  writeFileSync(agentsMdPath, summary.agentsMd, 'utf-8');
  filesWritten.push(agentsMdPath);

  const codexDir = join(dir, '.codex');
  mkdirSync(join(codexDir, 'skills'), { recursive: true });
  const tomlPath = join(codexDir, 'config.toml');
  writeFileSync(tomlPath, `${summary.mcpConfig}\n`, 'utf-8');
  filesWritten.push(tomlPath);

  const skillPath = join(codexDir, 'skills', `${summary.reviewSkill.name}.md`);
  writeFileSync(
    skillPath,
    `---\nname: ${summary.reviewSkill.name}\ndescription: ${summary.reviewSkill.description}\n---\n\n${summary.reviewSkill.instructions}\n`,
    'utf-8',
  );
  filesWritten.push(skillPath);
  return { side, filesWritten };
}
