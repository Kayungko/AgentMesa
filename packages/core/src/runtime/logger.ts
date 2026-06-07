import type { MesaActor, MesaLogger } from './types.js';

export function createConsoleLogger(actor: MesaActor): MesaLogger {
  const write = (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>
  ): void => {
    console[level](`[AgentMesa] ${message}`, {
      actor: actor.id,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}
