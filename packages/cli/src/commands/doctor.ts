import {
  isWorkspaceInitialized,
  loadConfig,
  createWorkspacePaths,
  cleanOrphanedTempFiles,
  findOrphanedTempFiles,
  createRuntimeContext,
  validateEventLog,
  checkProjectionConsistency,
  checkTransportEnvelopes,
  findOrphanedLocks,
  listTaskProjections,
  listMeetingProjections,
  listAgentProjections,
} from '@agentmesa/core';
import type { DiagnosticFinding, MesaRuntimeContext } from '@agentmesa/core';
import { getSetupStatus } from '@agentmesa/setup';
import { existsSync } from 'node:fs';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printWarning, printError, printInfo, outputResult } from '../output.js';
import { runDoctorAsAgent } from './doctor-agent.js';
import type { DoctorAgentOptions } from './doctor-agent.js';

function isProjectionFresh(ctx: MesaRuntimeContext, streamId: string, proj: Record<string, unknown>): boolean {
  const events = ctx.eventStore.list({ streamId });
  if (events.length === 0) return true;
  const maxSeq = Math.max(...events.map((e) => e.sequence));
  const lastSeq = (proj._meta as { lastSequence?: number } | undefined)?.lastSequence;
  return lastSeq !== undefined && lastSeq >= maxSeq;
}

export function runDoctor(args: ParsedArgs, options?: DoctorAgentOptions): void {
  // Agent-perspective self-check: strictly read-only, independent of the host
  // environment checks below (which remain the default `mesa doctor` output).
  if (args.flags['as-agent']) {
    runDoctorAsAgent(args, options);
    return;
  }

  const rootDir = process.cwd();
  const json = !!args.flags['json'];
  let issues = 0;
  const findings: Array<{ level: string; category?: string; message: string; path?: string; resourceId?: string; fixable?: boolean; recommendation?: string }> = [];

  function record(finding: DiagnosticFinding): void {
    const item: typeof findings[number] = {
      level: finding.level,
      category: finding.category,
      message: finding.message,
    };
    if (finding.path) item.path = finding.path;
    if (finding.resourceId) item.resourceId = finding.resourceId;
    if (finding.fixable !== undefined) item.fixable = finding.fixable;
    if (finding.recommendation) item.recommendation = finding.recommendation;
    findings.push(item);
    if (finding.level === 'error' || finding.level === 'warn') issues++;
  }

  function recordSimple(level: string, message: string): void {
    findings.push({ level, category: 'general', message });
    if (level === 'error' || level === 'warn') issues++;
  }

  if (json) {
    // silent collection — no console output during check
  } else {
    console.log('AgentMesa Doctor');
    console.log('================');
    console.log('');
  }

  // Check workspace
  if (isWorkspaceInitialized(rootDir)) {
    recordSimple('ok', 'Workspace initialized');
    const config = loadConfig(rootDir);
    recordSimple('ok', `Protocol version: ${config.protocolVersion}`);
    if (config.projectName) recordSimple('ok', `Project: ${config.projectName}`);
  } else {
    recordSimple('warn', 'No AgentMesa workspace found. Run "mesa init" first.');
  }

  // Check git
  const gitDir = `${rootDir}/.git`;
  if (existsSync(gitDir)) {
    recordSimple('ok', 'Git repository found');
  } else {
    recordSimple('warn', 'No git repository found. Git connector features will be limited.');
  }

  // Check node_modules
  const nodeModules = `${rootDir}/node_modules`;
  if (existsSync(nodeModules)) {
    recordSimple('ok', 'node_modules exists');
  } else {
    recordSimple('ok', 'No node_modules found. Run your package manager install first.');
  }

  // Agent CLI integrations (claude / codex)
  try {
    const setup = getSetupStatus(rootDir);
    for (const side of ['claude', 'codex'] as const) {
      const s = setup[side];
      const label = side === 'claude' ? 'Claude CLI' : 'Codex CLI';
      if (!s.cliAvailable) {
        recordSimple('warn', `${label} not found on PATH — real ${side} runs are unavailable.`);
      } else if (!s.mcpInstalled) {
        recordSimple('warn', `${label} found but agentmesa MCP is not registered. Run "mesa plugin install ${side}".`);
      } else {
        recordSimple('ok', `${label} registered with agentmesa MCP.`);
      }
      if (setup.runnerSources[side] === 'stub') {
        recordSimple('warn', `${label} runner is in stub mode. Set a command via "mesa plugin runner ${side} <cmd>" or the AGENTMESA_${side.toUpperCase()}_CMD env var.`);
      } else {
        recordSimple('ok', `${label} runner command resolved from ${setup.runnerSources[side]}.`);
      }
    }
  } catch (err) {
    recordSimple('warn', `Skipping integration checks — ${String(err)}`);
  }

  // Workspace diagnostics
  if (isWorkspaceInitialized(rootDir)) {
    const paths = createWorkspacePaths(rootDir);

    // Agent dir
    if (existsSync(paths.agentsDir)) {
      recordSimple('ok', 'Agents directory exists');
    } else {
      recordSimple('warn', 'Agents directory missing.');
    }

    // Orphaned temp files
    const tempDirs = [
      paths.tasksDir,
      paths.messagesDir,
      paths.artifactsDir,
      paths.meetingsDir,
      paths.agentsDir,
    ];
    const fix = args.flags.fix === true;
    if (fix) {
      const removed = cleanOrphanedTempFiles(tempDirs);
      if (removed > 0) {
        recordSimple('warn', `Removed ${removed} orphaned temp file(s) from interrupted writes.`);
      } else {
        recordSimple('ok', 'No orphaned temp files.');
      }
    } else {
      const orphaned = findOrphanedTempFiles(tempDirs);
      if (orphaned.length > 0) {
        recordSimple('warn', `Found ${orphaned.length} orphaned temp file(s) from interrupted writes. Run "mesa doctor --fix" to remove them.`);
      } else {
        recordSimple('ok', 'No orphaned temp files.');
      }
    }

    // Event log validation
    const eventFindings = validateEventLog(paths.eventsDir);
    for (const f of eventFindings) {
      record(f);
    }

    // Runtime diagnostics (needs ctx for projection + lock checks)
    try {
      const ctx = createRuntimeContext({
        rootDir,
        actor: { id: 'user:doctor', type: 'user', roles: ['owner'] },
      });

      const projFindings = checkProjectionConsistency(ctx);
      for (const f of projFindings) {
        record(f);
      }

      // Stale projection freshness check
      for (const t of listTaskProjections(ctx, { strict: false })) {
        const taskId = t.id as string;
        if (!isProjectionFresh(ctx, taskId, t)) {
          record({
            level: 'warn',
            category: 'projection',
            message: `Stale projection for task "${taskId}" — events have been added since the last rebuild.`,
            resourceId: taskId,
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate projections.',
          });
        }
      }
      for (const m of listMeetingProjections(ctx, { strict: false })) {
        const meetingId = m.id as string;
        if (!isProjectionFresh(ctx, meetingId, m)) {
          record({
            level: 'warn',
            category: 'projection',
            message: `Stale projection for meeting "${meetingId}" — events have been added since the last rebuild.`,
            resourceId: meetingId,
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate projections.',
          });
        }
      }
      for (const a of listAgentProjections(ctx, { strict: false })) {
        const agentId = a.id as string;
        if (!isProjectionFresh(ctx, agentId, a)) {
          record({
            level: 'warn',
            category: 'projection',
            message: `Stale projection for agent "${agentId}" — events have been added since the last rebuild.`,
            resourceId: agentId,
            fixable: true,
            recommendation: 'Run "mesa rebuild" to regenerate projections.',
          });
        }
      }

      const lockFindings = findOrphanedLocks(ctx.paths);
      for (const f of lockFindings) {
        record(f);
      }

      const transportFindings = checkTransportEnvelopes(ctx);
      for (const f of transportFindings) {
        record(f);
      }
    } catch (err) {
      recordSimple('warn', `Skipping runtime diagnostics — ${String(err)}`);
    }
  }

  if (json) {
    outputResult({ issues, findings }, true);
    return;
  }

  // Human-readable output
  for (const f of findings) {
    const icon = f.level === 'error' ? '✗' : f.level === 'warn' ? '!' : '✓';
    const fn =
      f.level === 'error' ? printError : f.level === 'warn' ? printWarning : printSuccess;
    fn(`${icon} ${f.message}`);
  }

  console.log('');
  if (issues === 0) {
    printSuccess('All checks passed.');
  } else {
    printWarning(`${issues} issue(s) found.`);
  }
}
