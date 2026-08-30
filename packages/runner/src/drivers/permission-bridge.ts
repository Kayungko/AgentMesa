/**
 * M4 Deep Orchestration — permission bridging onto the AgentMesa policy engine.
 *
 * `run-executor.ts` exposes an injection point for deep-driver turns
 * (`permissionResponder?: (req) => Promise<'allow' | 'deny'>`) whose default is
 * deny-all (fail-closed). This module implements the real bridge: every
 * `DriverPermissionRequest` surfaced by a deep driver (Claude Agent SDK
 * `canUseTool`, Codex app-server approvals) is judged by the `@agentmesa/policy`
 * checkers instead of being blanket-denied.
 *
 * Judgment chain per request kind:
 *
 * - `command` — the command line is extracted from `detail` (string detail, or
 *   `command`/`cmd`/`commandLine` fields — the Codex approval payload shape),
 *   then: blocked command patterns (`CommandPolicyChecker`) → secret-path
 *   tokens (`SecretProtection`) → `run_command` role capability
 *   (`PermissionChecker`; checked before the approval gate so a human
 *   approval can never upgrade a role that may not run commands) →
 *   approval-required patterns (human gate) → allowlist membership (union of
 *   the policy SAFE_COMMANDS and the shell connector default allowlist;
 *   anything else is denied).
 * - `patch` — file paths are extracted from `detail` (`changes[].path`,
 *   `file_path`, `path`, `files`, `grantRoot`, ...), then: secret paths →
 *   `FileAccessChecker` write-scope rules per role. Paths are relativized
 *   against an optional workspace root so absolute paths still match the
 *   policy globs. No extractable path → deny (fail-closed).
 * - `tool` — the tool name maps to a `PolicyAction`
 *   (Write/Edit → modify_source, Bash → run_command, ...) and is judged by
 *   role capability; write tools additionally get a secret-path guard on
 *   their input. Tools with no mapping fall back to a conservative default:
 *   known read-only tools are allowed, unknown tools are denied (both
 *   defaults configurable).
 *
 * Human approval gate (`options.askHuman`): policy denials short-circuit —
 * the human is never asked. Only "allowed but requires approval" operations
 * (the policy package's confirmation-gate concept —
 * `CommandPolicyChecker`'s `requiresApproval`) consult the human, and the
 * human's answer is final. Without an `askHuman` callback such operations
 * are denied (still fail-closed).
 *
 * Every decision is reported through the optional `onDecision` callback as a
 * `PermissionDecisionRecord` (wire it to RunProgress / logging in the
 * executor); nothing is printed to the console. Any parse failure, unknown
 * payload structure, or thrown error inside the bridge resolves to deny.
 *
 * The responder is pure with respect to identity: the actor / roles come
 * exclusively from the options — nothing is read from the environment.
 */

import type { MesaActor, MesaPolicyEngine, MesaRuntimeContext } from '@agentmesa/core';
import type { AgentRole } from '@agentmesa/protocol';
import { CommandPolicyChecker, FileAccessChecker, PermissionChecker, SecretProtection } from '@agentmesa/policy';
import type { FileAccessRule, PolicyAction, RoleCapability } from '@agentmesa/policy';
import type { DriverPermissionRequest } from './types.js';
import type { DriverPermissionResponder } from '../run-executor.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One auditable permission decision produced by the bridge. */
export interface PermissionDecisionRecord {
  /** ISO timestamp of the decision. */
  timestamp: string;
  /** The driver-scoped request id (echoed from DriverPermissionRequest). */
  requestId: string;
  /** Request kind: tool | command | patch. */
  kind: DriverPermissionRequest['kind'];
  /** Final verdict. */
  decision: 'allow' | 'deny';
  /** Machine-readable rule that produced the verdict, e.g. `command.blocked`. */
  rule: string;
  /** Human-readable explanation (also suitable as a deny message). */
  reason: string;
  /** Subject of the decision: tool name, command line, or file path list. */
  resource: string;
  /** Actor the decision was evaluated for, when identity was supplied. */
  actorId?: string;
  /** Roles used for capability evaluation (empty when no identity). */
  roles: string[];
  /** Present when the final verdict came from the askHuman gate. */
  viaHuman?: boolean;
}

/**
 * Tool name (normalized, lowercase) → policy judgment. `'readonly'` marks
 * tools allowed without a capability check. Unmapped tools fall through to
 * the conservative default (readonly allow / unknown deny).
 */
export type ToolPolicyMap = Record<string, PolicyAction | 'readonly'>;

/** Options for {@link createPolicyPermissionResponder}. */
export interface PolicyPermissionResponderOptions {
  /** Actor the driver acts on behalf of; roles are read from `actor.roles`. */
  actor?: MesaActor;
  /** Explicit role list; wins over `actor.roles` when both are given. */
  roles?: readonly string[];
  /** Capability checker; defaults to `new PermissionChecker(capabilities)`. */
  permissionChecker?: PermissionChecker;
  /** Capability table for the default PermissionChecker. */
  capabilities?: RoleCapability;
  /** Command policy checker (blocked / approval-required patterns). */
  commandChecker?: CommandPolicyChecker;
  /** Extra allowlisted command prefixes; anything else is denied. */
  commandAllowlist?: readonly string[];
  /** File access checker; defaults to `new FileAccessChecker(fileAccessRules)`. */
  fileAccess?: FileAccessChecker;
  /** Access rules for the default FileAccessChecker. */
  fileAccessRules?: FileAccessRule[];
  /** Secret path scanner; defaults to `new SecretProtection()`. */
  secretProtection?: SecretProtection;
  /**
   * Workspace root used to relativize absolute paths before file-access rule
   * matching (the policy globs are workspace-relative). Optional.
   */
  workspaceRootDir?: string;
  /** Additional/overriding tool → policy mappings. */
  toolPolicyMap?: ToolPolicyMap;
  /** Policy for tools with no mapping that are not known read-only. Default 'deny'. */
  unknownToolPolicy?: 'allow' | 'deny';
  /** Policy for known read-only tools with no mapping. Default 'allow'. */
  readonlyToolPolicy?: 'allow' | 'deny';
  /**
   * Optional second opinion from the core runtime policy engine
   * (`ctx.policy`). Only consulted for tool actions that have a core
   * capability mapping (see CORE_ACTION_BY_POLICY_ACTION); a denial there
   * overrides an otherwise-allowed tool call.
   */
  corePolicy?: MesaPolicyEngine;
  /** Audit callback for every decision (allow and deny). Must not throw. */
  onDecision?: (record: PermissionDecisionRecord) => void | Promise<void>;
  /**
   * Human approval gate for "policy allows but requires confirmation"
   * operations. The human's answer is final; errors are treated as deny.
   */
  askHuman?: (request: DriverPermissionRequest) => Promise<'allow' | 'deny'>;
}

/** Options for {@link attachPermissionResponder}. */
export interface AttachPermissionResponderOptions
  extends Omit<PolicyPermissionResponderOptions, 'actor' | 'corePolicy'> {
  /** Runtime context providing the actor, workspace root, and policy engine. */
  ctx: MesaRuntimeContext;
  /** Actor evaluated by the bridge; defaults to `ctx.actor`. */
  actor?: MesaActor;
  /** Consult `ctx.policy` for tool actions with a core mapping. Default true. */
  useCorePolicy?: boolean;
}

// ---------------------------------------------------------------------------
// Default tables (aligned with existing checkers — see header comment)
// ---------------------------------------------------------------------------

/**
 * Default command allowlist. Union of `@agentmesa/policy`'s
 * `CommandPolicyChecker` SAFE_COMMANDS and the shell connector's
 * DEFAULT_ALLOWLIST, matching their prefix-match semantics (exact match or
 * `entry + ' '` prefix). Commands outside this list are denied.
 */
export const DEFAULT_COMMAND_ALLOWLIST: readonly string[] = [
  // --- @agentmesa/policy SAFE_COMMANDS ---
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git show',
  'git stash list',
  'npm test',
  'npm run test',
  'pnpm test',
  'pnpm run test',
  'npx vitest run',
  'npx tsc --noEmit',
  'npx eslint',
  'cat',
  'ls',
  'pwd',
  'echo',
  'node --version',
  'npm --version',
  'pnpm --version',
  // --- connectors/shell DEFAULT_ALLOWLIST ---
  'npm run build',
  'npm run lint',
  'npm run typecheck',
  'pnpm build',
  'pnpm lint',
  'pnpm typecheck',
  'yarn test',
  'yarn build',
  'yarn lint',
  'yarn typecheck',
];

/** Default tool name → policy action mapping (normalized, lowercase). */
const DEFAULT_TOOL_POLICY_MAP: ToolPolicyMap = {
  // source-modifying tools
  write: 'modify_source',
  edit: 'modify_source',
  multiedit: 'modify_source',
  notebookedit: 'modify_source',
  apply_patch: 'modify_source',
  create_file: 'modify_source',
  update_file: 'modify_source',
  str_replace: 'modify_source',
  str_replace_editor: 'modify_source',
  // shell execution
  bash: 'run_command',
  shell: 'run_command',
  terminal: 'run_command',
  execute_command: 'run_command',
  run_command: 'run_command',
  // git write operations
  git_push: 'push_code',
  push_code: 'push_code',
  git_merge: 'merge_pr',
  merge_pr: 'merge_pr',
  // Mesa-shaped operations
  create_artifact: 'create_artifact',
  artifact_create: 'create_artifact',
  write_task: 'write_task',
  update_task: 'write_task',
  todo_write: 'write_task',
};

/** Tools allowed without a capability check (no mapping required). */
const READONLY_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'read_file',
  'ls',
  'glob',
  'grep',
  'search',
  'find',
  'list',
  'view',
  'show',
  'webfetch',
  'websearch',
  'web_search',
  'todo_read',
]);

/**
 * PolicyAction → core ACTION_CAPABILITY action. Only tool actions with a core
 * vocabulary are gated through `ctx.policy`; the others are judged solely by
 * the policy-package checkers (the core engine has no matching action).
 */
const CORE_ACTION_BY_POLICY_ACTION: Partial<Record<PolicyAction, string>> = {
  post_message: 'message.append',
  create_artifact: 'artifact.create',
  manage_runs: 'run.read',
};

const RESOURCE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Small payload helpers (defensive — `detail` is unknown by contract)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Extract the command line from a command-kind detail payload. */
function extractCommand(detail: unknown): string | undefined {
  if (typeof detail === 'string') {
    return asNonEmptyString(detail);
  }
  const record = asRecord(detail);
  if (!record) {
    return undefined;
  }
  for (const key of ['command', 'cmd', 'commandLine', 'command_line']) {
    const value = asNonEmptyString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Extract the tool name from a tool-kind detail payload. */
function extractToolName(detail: unknown): string | undefined {
  if (typeof detail === 'string') {
    return asNonEmptyString(detail);
  }
  const record = asRecord(detail);
  if (!record) {
    return undefined;
  }
  for (const key of ['toolName', 'tool', 'name']) {
    const value = asNonEmptyString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Detail keys that may carry file paths (tool inputs, patch payloads). */
const PATH_KEYS: ReadonlySet<string> = new Set([
  'file_path',
  'filePath',
  'path',
  'paths',
  'files',
  'changes',
  'grantRoot',
  'grant_root',
  'target',
]);

/** Recursively collect path-like strings from a detail payload. */
function collectPaths(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      into.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPaths(item, into);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (PATH_KEYS.has(key)) {
      collectPaths(nested, into);
    }
  }
}

function truncate(text: string): string {
  return text.length > RESOURCE_LIMIT ? `${text.slice(0, RESOURCE_LIMIT)}…` : text;
}

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Relativize an absolute path against the workspace root for rule matching. */
function relativizeForRules(path: string, workspaceRootDir: string | undefined): string {
  if (workspaceRootDir === undefined || workspaceRootDir.length === 0) {
    return path;
  }
  const normalized = normalizeSeparators(path);
  const root = normalizeSeparators(workspaceRootDir).replace(/\/+$/, '');
  if (root.length === 0) {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();
  if (lower === rootLower) {
    return '.';
  }
  if (lower.startsWith(`${rootLower}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Responder factory
// ---------------------------------------------------------------------------

/** Internal judgment before the human gate. */
interface Verdict {
  decision: 'allow' | 'deny';
  rule: string;
  reason: string;
  /** Policy allows, but a confirmation gate must clear first. */
  needsHuman?: boolean;
}

/**
 * Create a `permissionResponder` for deep-driver turns that judges every
 * `DriverPermissionRequest` through the AgentMesa policy engine. Fail-closed:
 * unparsable payloads, unknown structures, and internal errors all deny.
 */
export function createPolicyPermissionResponder(
  options: PolicyPermissionResponderOptions = {},
): DriverPermissionResponder {
  const permissionChecker =
    options.permissionChecker ?? new PermissionChecker(options.capabilities);
  const commandChecker = options.commandChecker ?? new CommandPolicyChecker();
  const fileAccess = options.fileAccess ?? new FileAccessChecker(options.fileAccessRules);
  const secretProtection = options.secretProtection ?? new SecretProtection();
  const allowlist = options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST;
  const toolPolicyMap: ToolPolicyMap = { ...DEFAULT_TOOL_POLICY_MAP, ...options.toolPolicyMap };
  const unknownToolPolicy = options.unknownToolPolicy ?? 'deny';
  const readonlyToolPolicy = options.readonlyToolPolicy ?? 'allow';
  const workspaceRootDir = options.workspaceRootDir;

  const actor = options.actor;
  const roles: string[] =
    options.roles !== undefined
      ? [...options.roles]
      : actor !== undefined
        ? actor.roles.filter((role) => typeof role === 'string').map((role) => String(role))
        : [];
  const actorId = actor?.id;

  const hasCapability = (action: PolicyAction): boolean =>
    roles.some((role) => permissionChecker.canPerform(role as AgentRole, action));

  function deny(rule: string, reason: string): Verdict {
    return { decision: 'deny', rule, reason };
  }

  function judgeCommand(request: DriverPermissionRequest): Verdict {
    const command = extractCommand(request.detail);
    if (command === undefined) {
      return deny(
        'command.unparsed',
        'command permission request carried no parsable command line',
      );
    }
    for (const token of command.split(/\s+/)) {
      if (secretProtection.isSecretPath(token)) {
        return deny(
          'command.secret_path',
          `command references a protected secret path: ${token}`,
        );
      }
    }
    const check = commandChecker.isAllowed(command);
    if (!check.allowed && !check.requiresApproval) {
      return deny('command.blocked', check.reason ?? 'command is blocked by command policy');
    }
    // Capability before the approval gate: a human approval must never
    // upgrade a role that is not allowed to run commands at all.
    if (!hasCapability('run_command')) {
      return deny(
        'command.capability',
        `roles [${roles.join(', ')}] lack the "run_command" capability`,
      );
    }
    if (!check.allowed && check.requiresApproval) {
      return {
        decision: 'deny',
        rule: 'command.approval_required',
        reason: check.reason ?? 'command requires human approval',
        needsHuman: true,
      };
    }
    const allowlisted = allowlist.some(
      (allowed) => command === allowed || command.startsWith(`${allowed} `),
    );
    if (!allowlisted) {
      return deny(
        'command.not_allowlisted',
        `command is not in the allowed command list: ${command}`,
      );
    }
    return { decision: 'allow', rule: 'command.allow', reason: 'allowlisted command' };
  }

  function judgePatch(request: DriverPermissionRequest): Verdict {
    const paths: string[] = [];
    collectPaths(request.detail, paths);
    if (paths.length === 0) {
      return deny('patch.unparsed', 'patch permission request carried no parsable file path');
    }
    for (const path of paths) {
      if (secretProtection.isSecretPath(path)) {
        return deny('patch.secret_path', `patch touches a protected secret path: ${path}`);
      }
    }
    for (const path of paths) {
      const rulePath = relativizeForRules(path, workspaceRootDir);
      const accessible = roles.some((role) =>
        fileAccess.canAccess(rulePath, role as AgentRole),
      );
      if (!accessible) {
        return deny(
          'patch.out_of_scope',
          `file access policy denies writing ${path} for roles [${roles.join(', ')}]`,
        );
      }
    }
    return { decision: 'allow', rule: 'patch.allow', reason: 'path within write scope' };
  }

  function judgeTool(request: DriverPermissionRequest): Verdict {
    const toolName = extractToolName(request.detail);
    if (toolName === undefined) {
      return deny('tool.unparsed', 'tool permission request carried no parsable tool name');
    }
    const normalized = toolName.toLowerCase();
    const policy = toolPolicyMap[normalized];

    if (policy === undefined) {
      if (READONLY_TOOLS.has(normalized)) {
        if (readonlyToolPolicy === 'allow') {
          return {
            decision: 'allow',
            rule: 'tool.readonly',
            reason: `read-only tool "${toolName}" allowed by default policy`,
          };
        }
        return deny(
          'tool.readonly_denied',
          `read-only tool "${toolName}" denied by configured default policy`,
        );
      }
      if (unknownToolPolicy === 'allow') {
        return {
          decision: 'allow',
          rule: 'tool.unknown_allowed',
          reason: `unknown tool "${toolName}" allowed by configured default policy`,
        };
      }
      return deny(
        'tool.unknown',
        `unknown tool "${toolName}" has no policy mapping; denied by default`,
      );
    }

    if (policy === 'readonly') {
      return {
        decision: 'allow',
        rule: 'tool.readonly',
        reason: `read-only tool "${toolName}" allowed by tool policy map`,
      };
    }

    if (!hasCapability(policy)) {
      return deny(
        'tool.capability',
        `roles [${roles.join(', ')}] lack the "${policy}" capability for tool "${toolName}"`,
      );
    }

    if (policy === 'modify_source') {
      const paths: string[] = [];
      const record = asRecord(request.detail);
      if (record !== undefined) {
        collectPaths(record['input'], paths);
      }
      for (const path of paths) {
        if (secretProtection.isSecretPath(path)) {
          return deny(
            'tool.secret_path',
            `tool "${toolName}" would write a protected secret path: ${path}`,
          );
        }
      }
    }

    if (options.corePolicy !== undefined && actor !== undefined) {
      const coreAction = CORE_ACTION_BY_POLICY_ACTION[policy];
      if (coreAction !== undefined) {
        const decision = options.corePolicy.can(actor, coreAction, `tool:${normalized}`);
        if (!decision.allowed) {
          return deny(
            'tool.core_policy',
            decision.reason ?? `core policy denied action "${coreAction}" for tool "${toolName}"`,
          );
        }
      }
    }

    return {
      decision: 'allow',
      rule: 'tool.allow',
      reason: `tool "${toolName}" permitted by capability "${policy}"`,
    };
  }

  function judge(request: DriverPermissionRequest): { verdict: Verdict; resource: string } {
    switch (request.kind) {
      case 'command': {
        const command = extractCommand(request.detail);
        return { verdict: judgeCommand(request), resource: command ?? request.title };
      }
      case 'patch': {
        const paths: string[] = [];
        collectPaths(request.detail, paths);
        return { verdict: judgePatch(request), resource: truncate(paths.join(', ')) };
      }
      case 'tool':
      default: {
        const toolName = extractToolName(request.detail);
        return { verdict: judgeTool(request), resource: toolName ?? request.title };
      }
    }
  }

  return async (request: DriverPermissionRequest): Promise<'allow' | 'deny'> => {
    let verdict: Verdict;
    let resource: string;
    let viaHuman = false;
    try {
      const judgment = judge(request);
      verdict = judgment.verdict;
      resource = judgment.resource;

      if (verdict.needsHuman) {
        if (options.askHuman === undefined) {
          verdict = deny(
            'approval.required',
            `${verdict.reason}; no human approval gate is configured`,
          );
        } else {
          viaHuman = true;
          try {
            const answer = await options.askHuman(request);
            verdict = {
              decision: answer === 'allow' ? 'allow' : 'deny',
              rule: answer === 'allow' ? 'human.approved' : 'human.denied',
              reason:
                answer === 'allow'
                  ? `${verdict.reason}; approved by human`
                  : `${verdict.reason}; denied by human`,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            verdict = deny('human.gate_error', `human approval gate failed: ${message}`);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verdict = deny('bridge.error', `permission bridge failed: ${message}`);
      resource = request.title;
    }

    const record: PermissionDecisionRecord = {
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      kind: request.kind,
      decision: verdict.decision,
      rule: verdict.rule,
      reason: verdict.reason,
      resource,
      roles: [...roles],
      ...(actorId !== undefined ? { actorId } : {}),
      ...(viaHuman ? { viaHuman: true } : {}),
    };
    try {
      await options.onDecision?.(record);
    } catch {
      // Auditing must never change the verdict.
    }
    return verdict.decision;
  };
}

// ---------------------------------------------------------------------------
// MesaRuntimeContext convenience wiring
// ---------------------------------------------------------------------------

/**
 * Attach a policy-backed `permissionResponder` to executor options (the
 * `RunExecutorOptions` shape — or anything carrying the same field). Bridges
 * the core `MesaRuntimeContext`: the actor and workspace root come from the
 * context, and `ctx.policy` is consulted as a second opinion for tool actions
 * that have a core capability mapping (disable with `useCorePolicy: false`).
 *
 * Non-mutating: returns a new options object. Example:
 *
 * ```ts
 * const options = attachPermissionResponder(runOptions, { ctx, askHuman });
 * await executeRun(ctx, runId, options);
 * ```
 */
export function attachPermissionResponder<T extends object>(
  executorOptions: T,
  options: AttachPermissionResponderOptions,
): T & { permissionResponder: DriverPermissionResponder } {
  const { ctx, actor, useCorePolicy, ...responderOptions } = options;
  const permissionResponder = createPolicyPermissionResponder({
    ...responderOptions,
    actor: actor ?? ctx.actor,
    corePolicy: useCorePolicy === false ? undefined : ctx.policy,
    ...(responderOptions.workspaceRootDir === undefined
      ? { workspaceRootDir: ctx.rootDir }
      : {}),
  });
  return { ...executorOptions, permissionResponder };
}
