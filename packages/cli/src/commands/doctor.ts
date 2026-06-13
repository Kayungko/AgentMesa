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
import { printSuccess, printWarning, printError, printInfo } from '../output.js';

function printFinding(f: DiagnosticFinding): void {
  const icon = f.level === 'error' ? '✗' : f.level === 'warn' ? '!' : '✓';
  const fn =
    f.level === 'error' ? printError : f.level === 'warn' ? printWarning : printSuccess;
  fn(`${icon} ${f.message}`);
}

export function runDoctor(args: ParsedArgs): void {
  const rootDir = process.cwd();
  let issues = 0;

  console.log('AgentMesa Doctor');
  console.log('================');
  console.log('');

  // Check workspace
  if (isWorkspaceInitialized(rootDir)) {
    printSuccess('Workspace initialized');
    const config = loadConfig(rootDir);
    printInfo(`Protocol version: ${config.protocolVersion}`);
    if (config.projectName) printInfo(`Project: ${config.projectName}`);
  } else {
    printWarning('No AgentMesa workspace found. Run "mesa init" first.');
    issues++;
  }

  // Check git
  const gitDir = `${rootDir}/.git`;
  if (existsSync(gitDir)) {
    printSuccess('Git repository found');
  } else {
    printWarning('No git repository found. Git connector features will be limited.');
    issues++;
  }

  // Check node_modules
  const nodeModules = `${rootDir}/node_modules`;
  if (existsSync(nodeModules)) {
    printSuccess('node_modules exists');
  } else {
    printInfo('No node_modules found. Run your package manager install first.');
  }

  // Workspace diagnostics
  if (isWorkspaceInitialized(rootDir)) {
    const paths = createWorkspacePaths(rootDir);

    // Agent dir
    if (existsSync(paths.agentsDir)) {
      printSuccess('Agents directory exists');
    } else {
      printWarning('Agents directory missing.');
      issues++;
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
        printWarning(`Removed ${removed} orphaned temp file(s) from interrupted writes.`);
      } else {
        printSuccess('No orphaned temp files.');
      }
    } else {
      const orphaned = findOrphanedTempFiles(tempDirs);
      if (orphaned.length > 0) {
        printWarning(
          `Found ${orphaned.length} orphaned temp file(s) from interrupted writes. Run "mesa doctor --fix" to remove them.`,
        );
        issues++;
      } else {
        printSuccess('No orphaned temp files.');
      }
    }

    // Event log validation
    const eventFindings = validateEventLog(paths.eventsDir);
    for (const f of eventFindings) {
      printFinding(f);
      if (f.level !== 'ok') issues++;
    }

    // Runtime diagnostics (needs ctx for projection + lock checks)
    try {
      const ctx = createRuntimeContext({
        rootDir,
        actor: { id: 'user:doctor', type: 'user', roles: ['owner'] },
      });

      const projFindings = checkProjectionConsistency(ctx);
      for (const f of projFindings) {
        printFinding(f);
        if (f.level !== 'ok') issues++;
      }

      const lockFindings = findOrphanedLocks(ctx.paths);
      for (const f of lockFindings) {
        printFinding(f);
        if (f.level !== 'ok') issues++;
      }
    } catch (err) {
      printWarning(`Skipping runtime diagnostics — ${String(err)}`);
      issues++;
    }
  }

  console.log('');
  if (issues === 0) {
    printSuccess('All checks passed.');
  } else {
    printWarning(`${issues} issue(s) found.`);
  }
}
