import {
  isWorkspaceInitialized,
  loadConfig,
  createWorkspacePaths,
  cleanOrphanedTempFiles,
  findOrphanedTempFiles,
  createRuntimeContext,
  validateEventLog,
  checkProjectionConsistency,
  findOrphanedLocks,
} from '@agentmesa/core';
import type { DiagnosticFinding } from '@agentmesa/core';
import { existsSync } from 'node:fs';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printWarning, printError, printInfo, outputResult } from '../output.js';

export function runDoctor(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const json = !!args.flags['json'];
  let issues = 0;
  const findings: Array<{ level: string; message: string; path?: string; resourceId?: string; fixable?: boolean; recommendation?: string }> = [];

  function record(finding: DiagnosticFinding): void {
    const item: typeof findings[number] = {
      level: finding.level,
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
    findings.push({ level, message });
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

      const lockFindings = findOrphanedLocks(ctx.paths);
      for (const f of lockFindings) {
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
