import {
  getSetupStatus,
  installMcpIntegration,
  uninstallMcpIntegration,
  setRunnerCommands,
  installProjectFiles,
  isIntegrationSide,
  type RunnerCommandPatch,
  type SetupStatus,
} from '@agentmesa/setup';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError, printInfo, outputResult } from '../output.js';

export function runPlugin(args: ParsedArgs): void {
  const rootDir = process.cwd();
  const json = !!args.flags['json'];

  try {
    switch (args.subcommand) {
      case 'status': {
        const status = getSetupStatus(rootDir);
        outputResult(status, json, () => printStatus(status));
        return;
      }

      case 'install': {
        const side = args.positional[0];
        if (!side || !isIntegrationSide(side)) {
          console.log('Usage: mesa plugin install <claude|codex> [--project <dir>]');
          process.exitCode = 1;
          return;
        }
        const result = installMcpIntegration(side);
        if (!result.ok) {
          printError(`Install failed: ${result.output}`);
          printInfo(`Command: ${result.command}`);
          process.exitCode = 1;
          return;
        }
        printSuccess(`Registered agentmesa MCP server with ${side} (user scope)`);
        if (result.output) {
          console.log(`  ${result.output}`);
        }
        const project = args.flags['project'];
        if (typeof project === 'string') {
          const files = installProjectFiles(side, project);
          printSuccess(`Wrote ${files.filesWritten.length} project file(s):`);
          for (const file of files.filesWritten) {
            console.log(`  ${file}`);
          }
        }
        return;
      }

      case 'uninstall': {
        const side = args.positional[0];
        if (!side || !isIntegrationSide(side)) {
          console.log('Usage: mesa plugin uninstall <claude|codex>');
          process.exitCode = 1;
          return;
        }
        const result = uninstallMcpIntegration(side);
        if (!result.ok) {
          printError(`Uninstall failed: ${result.output}`);
          printInfo(`Command: ${result.command}`);
          process.exitCode = 1;
          return;
        }
        printSuccess(`Removed agentmesa MCP server from ${side}`);
        if (result.output) {
          console.log(`  ${result.output}`);
        }
        return;
      }

      case 'runner': {
        const side = args.positional[0];
        if (!side || !isIntegrationSide(side)) {
          console.log('Usage: mesa plugin runner <claude|codex> "<command>" | --clear');
          process.exitCode = 1;
          return;
        }
        const clear = args.flags['clear'] === true;
        const command = args.positional[1];
        if (!clear && !command) {
          console.log('Usage: mesa plugin runner <claude|codex> "<command>" | --clear');
          process.exitCode = 1;
          return;
        }
        const patch: RunnerCommandPatch = side === 'claude'
          ? { claudeCmd: clear ? null : command }
          : { codexCmd: clear ? null : command };
        const runners = setRunnerCommands(rootDir, patch);
        if (json) {
          outputResult(runners, true);
          return;
        }
        if (clear) {
          printSuccess(`Cleared stored ${side} runner command`);
        } else {
          printSuccess(`Stored ${side} runner command: ${command}`);
        }
        const stored = side === 'claude' ? runners.claudeCmd : runners.codexCmd;
        printInfo(`Effective: ${stored ?? '(unset — env var or stub fallback applies)'}`);
        return;
      }

      default:
        console.log('Usage: mesa plugin <subcommand>');
        console.log('');
        console.log('Subcommands:');
        console.log('  status                       Show CLI / MCP / runner integration status');
        console.log('  install <claude|codex>       Register agentmesa MCP with the CLI (user scope)');
        console.log('                   --project <dir>  Also write project files into <dir>');
        console.log('  uninstall <claude|codex>     Remove the agentmesa MCP registration');
        console.log('  runner <claude|codex> "<cmd>"  Store the runner CLI command in .agentmesa/config.json');
        console.log('  runner <claude|codex> --clear  Clear the stored runner command');
    }
  } catch (err) {
    printError(err);
    process.exitCode = 1;
  }
}

function printStatus(status: SetupStatus): void {
  printSuccess('AgentMesa integrations');
  for (const side of ['claude', 'codex'] as const) {
    const s = status[side];
    const cli = s.cliAvailable ? 'CLI available' : 'CLI not found';
    const mcp = s.mcpInstalled ? 'MCP registered' : 'MCP not registered';
    console.log(`  ${side === 'claude' ? 'Claude' : 'Codex'} : ${cli} · ${mcp} · runner source ${status.runnerSources[side]}`);
  }
  console.log(`  Runner commands:`);
  console.log(`    claude: ${status.runners.claudeCmd ?? '(unset)'}`);
  console.log(`    codex : ${status.runners.codexCmd ?? '(unset)'}`);
  console.log('');
}
