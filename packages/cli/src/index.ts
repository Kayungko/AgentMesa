import { createWorkspacePaths } from '@agentmesa/core';

const command = process.argv[2] ?? 'help';

if (command === 'init') {
  const rootDir = process.cwd();
  const paths = createWorkspacePaths(rootDir);
  console.log(`AgentMesa workspace: ${paths.mesaDir}`);
  console.log('Initialization scaffolding will be implemented in Mesa Core.');
} else {
  console.log('AgentMesa CLI');
  console.log('Usage: mesa init');
}
