export interface MesaWorkspacePaths {
  rootDir: string;
  mesaDir: string;
  tasksDir: string;
  messagesDir: string;
  artifactsDir: string;
  logsDir: string;
  locksDir: string;
}

export function createWorkspacePaths(rootDir: string): MesaWorkspacePaths {
  const mesaDir = `${rootDir}/.agentmesa`;

  return {
    rootDir,
    mesaDir,
    tasksDir: `${mesaDir}/tasks`,
    messagesDir: `${mesaDir}/messages`,
    artifactsDir: `${mesaDir}/artifacts`,
    logsDir: `${mesaDir}/logs`,
    locksDir: `${mesaDir}/locks`,
  };
}
