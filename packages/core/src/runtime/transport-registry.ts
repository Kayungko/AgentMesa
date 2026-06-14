import { MesaError, PolicyDeniedError } from '../errors.js';
import type { MesaRuntimeContext, MesaTransport } from './types.js';

export function registerTransport(
  ctx: MesaRuntimeContext,
  transport: MesaTransport,
): void {
  if (ctx.transports.some((t) => t.name === transport.name)) {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Transport "${transport.name}" is already registered`,
    );
  }
  ctx.transports.push(transport);
}

export function listTransports(ctx: MesaRuntimeContext): MesaTransport[] {
  return [...ctx.transports];
}

export function getTransport(
  ctx: MesaRuntimeContext,
  name: string,
): MesaTransport {
  const transport = ctx.transports.find((t) => t.name === name);
  if (!transport) {
    throw new MesaError('TRANSPORT_NOT_FOUND', `Transport not found: ${name}`);
  }
  return transport;
}

export function inspectTransport(
  ctx: MesaRuntimeContext,
  name: string,
): MesaTransport {
  const decision = ctx.policy.can(ctx.actor, 'transport.inspect', `transport:${name}`);
  if (!decision.allowed) {
    throw new PolicyDeniedError(
      'transport.inspect',
      `transport:${name}`,
      decision.reason,
    );
  }
  return getTransport(ctx, name);
}
