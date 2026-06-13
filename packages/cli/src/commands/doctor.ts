import {
  isWorkspaceInitialized,
  loadConfig,
  createWorkspacePaths,
  cleanOrphanedTempFiles,
} from '@agentmesa/core';
import { existsSync } from 'node:fs';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printWarning, printError, printInfo } from '../output.js';

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

  // Check agents and clean orphaned temp files
  if (isWorkspaceInitialized(rootDir)) {
    const paths = createWorkspacePaths(rootDir);
    if (existsSync(paths.agentsDir)) {
      printSuccess('Agents directory exists');
    } else {
      printWarning('Agents directory missing.');
      issues++;
    }

    const removed = cleanOrphanedTempFiles([
      paths.tasksDir,
      paths.messagesDir,
      paths.artifactsDir,
      paths.meetingsDir,
      paths.agentsDir,
    ]);
    if (removed > 0) {
      printWarning(`Removed ${removed} orphaned temp file(s) from interrupted writes.`);
    } else {
      printSuccess('No orphaned temp files.');
    }
  }

  console.log('');
  if (issues === 0) {
    printSuccess('All checks passed.');
  } else {
    printWarning(`${issues} issue(s) found.`);
  }
}
