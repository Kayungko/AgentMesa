import {
  addWorkspace,
  clearRegistry,
  getActiveWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  setActiveWorkspace,
} from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, outputResult } from '../output.js';

export function runWorkspace(args: ParsedArgs): void {
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'add': {
        const rootDir = args.positional[0];
        if (!rootDir) {
          console.log('Usage: mesa workspace add <rootDir> [--name <name>]');
          return;
        }
        const name = typeof args.flags['name'] === 'string' ? args.flags['name'] : undefined;
        const workspace = addWorkspace({ rootDir, ...(name ? { name } : {}) });
        outputResult(workspace, json, () => printSuccess(`Registered workspace: ${workspace.name} (${workspace.id})`));
        return;
      }

      case 'list': {
        const workspaces = listWorkspaces();
        const active = getActiveWorkspace();
        outputResult(workspaces, json, () => {
          if (workspaces.length === 0) {
            console.log('No workspaces registered. Add one with: mesa workspace add <rootDir>');
          } else {
            console.log(`\n  ${'ID'.padEnd(14)} ${'Name'.padEnd(20)} Root`);
            console.log(`  ${'─'.repeat(14)} ${'─'.repeat(20)} ${'─'.repeat(40)}`);
            for (const workspace of workspaces) {
              const marker = active?.id === workspace.id ? '● ' : '  ';
              console.log(`  ${marker}${workspace.id.padEnd(12)} ${workspace.name.padEnd(20)} ${workspace.rootDir}`);
            }
            if (active) {
              console.log(`\n  Active: ${active.name} (${active.id})`);
            }
            console.log('');
          }
        });
        return;
      }

      case 'remove': {
        const workspaceId = args.positional[0];
        if (!workspaceId) {
          console.log('Usage: mesa workspace remove <workspaceId>');
          return;
        }
        removeWorkspace(workspaceId);
        outputResult({ ok: true }, json, () => printSuccess(`Removed workspace ${workspaceId}`));
        return;
      }

      case 'use': {
        const workspaceId = args.positional[0];
        if (!workspaceId) {
          console.log('Usage: mesa workspace use <workspaceId>');
          return;
        }
        const workspace = setActiveWorkspace(workspaceId);
        outputResult(workspace, json, () => printSuccess(`Active workspace: ${workspace.name} (${workspace.id})`));
        return;
      }

      case 'clear': {
        clearRegistry();
        outputResult({ ok: true }, json, () => printSuccess('Cleared workspace registry'));
        return;
      }

      case 'show': {
        const workspaceId = args.positional[0];
        const workspace = workspaceId
          ? getWorkspace(workspaceId)
          : getActiveWorkspace();
        if (!workspace) {
          outputResult(null, json, () => console.log('Workspace not found.'));
          return;
        }
        outputResult(workspace, json);
        return;
      }

      default:
        console.log('Usage: mesa workspace <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  add <rootDir> [--name <n>]   Register a workspace (must be mesa init-ed)');
        console.log('  list                         List registered workspaces');
        console.log('  show [<id>]                  Show a workspace (default: active)');
        console.log('  use <id>                     Set the active workspace');
        console.log('  remove <id>                  Remove a workspace from the registry');
        console.log('  clear                        Clear the whole registry');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}
