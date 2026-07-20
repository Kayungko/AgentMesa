import { DeskServer } from '@agentmesa/desk';
import type { ParsedArgs } from '../parse-args.js';
import { printSuccess, printError } from '../output.js';

export async function runDesk(args: ParsedArgs): Promise<void> {
  const rootDir = process.cwd();
  const port = typeof args.flags['port'] === 'string' ? Number(args.flags['port']) : 3456;

  const server = new DeskServer(rootDir, port);
  try {
    await server.start();
  } catch (err) {
    printError(err);
    process.exitCode = 1;
    return;
  }

  printSuccess(`AgentMesa Desk running at http://localhost:${server.getPort()}`);
  console.log('Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    void server.stop().then(() => process.exit(0));
  });
}
