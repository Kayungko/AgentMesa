import {
  createRuntimeContext,
  getAvailableTransports,
  listTransports,
  inspectTransport,
  MesaError,
} from '@agentmesa/core';
import type { MesaTransport, MesaRuntimeContext } from '@agentmesa/core';
import type { ParsedArgs } from '../parse-args.js';
import { outputResult, outputError } from '../output.js';

export function runTransports(args: ParsedArgs, ctxOverride?: MesaRuntimeContext): void {
  const subcommand = args.subcommand || 'list';
  const json = !!args.flags['json'];

  const ctx = ctxOverride ?? createRuntimeContext({
    rootDir: process.cwd(),
    actor: { id: 'user:local', type: 'user', roles: ['owner'] },
  });

  try {
    switch (subcommand) {
      case 'list':
        runList(ctx, json);
        break;
      case 'inspect':
        runInspect(ctx, args, json);
        break;
      case 'inbox':
        runInbox(ctx, args, json);
        break;
      case 'outbox':
        runOutbox(ctx, args, json);
        break;
      default:
        throw new MesaError('VALIDATION_ERROR', `Unknown subcommand: ${subcommand}`);
    }
  } catch (err) {
    outputError(err, json);
    process.exitCode = 1;
  }
}

function runList(ctx: ReturnType<typeof createRuntimeContext>, json: boolean): void {
  const available = getAvailableTransports(listTransports(ctx));

  outputResult(available, json, () => {
    if (available.length === 0) {
      console.log('No transports available.');
    } else {
      console.log(
        `\n  ${'Name'.padEnd(20)} ${'Type'.padEnd(12)} ${'Version'.padEnd(10)} ${'Available'}`,
      );
      console.log(
        `  ${'─'.repeat(20)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(9)}`,
      );
      for (const t of available) {
        console.log(
          `  ${t.name.padEnd(20)} ${t.type.padEnd(12)} ${t.version.padEnd(10)} ${t.isAvailable() ? 'yes' : 'no'}`,
        );
      }
      console.log(
        `\n  ${'─'.repeat(20)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(9)}`,
      );
      console.log('');

      for (const t of available) {
        console.log(`  ${t.name}:`);
        const caps = t.capabilities;
        const lines: string[] = [];
        if (caps.canCreateTasks) lines.push('create/read tasks');
        if (caps.canPostMessages) lines.push('post messages');
        if (caps.canAttachArtifacts) lines.push('attach artifacts');
        if (caps.canCreateMeetings) lines.push('create meetings');
        if (caps.canRegisterAgents) lines.push('register agents');
        if (caps.supportsPush) lines.push('push events');
        if (caps.supportsBidirectional) lines.push('bidirectional');
        console.log(`    ${lines.join(', ') || 'read-only'}`);
        console.log('');
      }
    }
  });
}

function runInspect(
  ctx: ReturnType<typeof createRuntimeContext>,
  args: ParsedArgs,
  json: boolean,
): void {
  const name = args.positional[0];
  if (!name) {
    throw new MesaError(
      'VALIDATION_ERROR',
      'Usage: mesa transports inspect <name>',
    );
  }
  const transport = inspectTransport(ctx, name);
  const result = {
    name: transport.name,
    type: transport.type,
    version: transport.version,
    available: transport.isAvailable(),
    capabilities: transport.capabilities,
    hasInbox: typeof transport.listInbound === 'function',
    hasOutbox: typeof transport.listOutbound === 'function',
  };
  outputResult(result, json, () => printTransportDetail(result));
}

const VALID_STATUS_VALUES = new Set(['pending', 'processed', 'failed']);

function validateStatus(status: unknown, json: boolean): 'pending' | 'processed' | 'failed' | undefined {
  if (status === undefined || status === null) return undefined;
  if (typeof status === 'string' && VALID_STATUS_VALUES.has(status)) {
    return status as 'pending' | 'processed' | 'failed';
  }
  throw new MesaError(
    'VALIDATION_ERROR',
    `Invalid --status value "${status}". Allowed: pending, processed, failed`,
  );
}

function runInbox(
  ctx: ReturnType<typeof createRuntimeContext>,
  args: ParsedArgs,
  json: boolean,
): void {
  const name = args.positional[0];
  if (!name) {
    throw new MesaError(
      'VALIDATION_ERROR',
      'Usage: mesa transports inbox <name>',
    );
  }
  const transport = inspectTransport(ctx, name);
  if (typeof transport.listInbound !== 'function') {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Transport "${name}" does not support inbox`,
    );
  }
  const status = validateStatus(args.flags['status'], json);
  const envelopes = transport.listInbound(status);
  outputResult({ transport: name, envelopes }, json, () => {
    printEnvelopeList(name, 'Inbound', envelopes);
  });
}

function runOutbox(
  ctx: ReturnType<typeof createRuntimeContext>,
  args: ParsedArgs,
  json: boolean,
): void {
  const name = args.positional[0];
  if (!name) {
    throw new MesaError(
      'VALIDATION_ERROR',
      'Usage: mesa transports outbox <name>',
    );
  }
  const transport = inspectTransport(ctx, name);
  if (typeof transport.listOutbound !== 'function') {
    throw new MesaError(
      'VALIDATION_ERROR',
      `Transport "${name}" does not support outbox`,
    );
  }
  const status = validateStatus(args.flags['status'], json);
  const envelopes = transport.listOutbound(status);
  outputResult({ transport: name, envelopes }, json, () => {
    printEnvelopeList(name, 'Outbound', envelopes);
  });
}

function printTransportDetail(transport: Record<string, unknown>): void {
  console.log(`\n  Name        : ${transport['name']}`);
  console.log(`  Type        : ${transport['type']}`);
  console.log(`  Version     : ${transport['version']}`);
  console.log(`  Available   : ${transport['available']}`);
  console.log(`  Has Inbox   : ${transport['hasInbox']}`);
  console.log(`  Has Outbox  : ${transport['hasOutbox']}`);
  const caps = transport['capabilities'] as MesaTransport['capabilities'];
  if (caps) {
    console.log('  Capabilities:');
    console.log(`    canCreateTasks       : ${caps.canCreateTasks}`);
    console.log(`    canReadTasks         : ${caps.canReadTasks}`);
    console.log(`    canUpdateTaskStatus  : ${caps.canUpdateTaskStatus}`);
    console.log(`    canPostMessages      : ${caps.canPostMessages}`);
    console.log(`    canAttachArtifacts   : ${caps.canAttachArtifacts}`);
    console.log(`    canCreateMeetings    : ${caps.canCreateMeetings}`);
    console.log(`    canRegisterAgents    : ${caps.canRegisterAgents}`);
    console.log(`    supportsPush         : ${caps.supportsPush}`);
    console.log(`    supportsBidirectional: ${caps.supportsBidirectional}`);
  }
  console.log('');
}

function printEnvelopeList(
  transportName: string,
  label: string,
  envelopes: Array<Record<string, unknown>>,
): void {
  console.log(`\n  ${label} envelopes for ${transportName}:`);
  if (envelopes.length === 0) {
    console.log('    (empty)\n');
    return;
  }
  console.log(
    `  ${'ID'.padEnd(16)} ${'Type'.padEnd(20)} ${'Direction'.padEnd(10)} ${'Status'.padEnd(10)} ${'Created'}`,
  );
  console.log(
    `  ${'─'.repeat(16)} ${'─'.repeat(20)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(20)}`,
  );
  for (const env of envelopes) {
    const id = String(env['id'] || '').padEnd(16);
    const type = String(env['type'] || '').slice(0, 20).padEnd(20);
    const dir = String(env['direction'] || '').padEnd(10);
    const status = String(env['status'] || '').padEnd(10);
    const created = String(env['createdAt'] || '');
    console.log(`  ${id} ${type} ${dir} ${status} ${created}`);
  }
  console.log('');
}
