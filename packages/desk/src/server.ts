import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  appendMessage,
  createRuntimeContext,
  getArtifact,
  getMeeting,
  getTask,
  listAgents,
  listAgentRuns,
  listArtifacts,
  listCheckResults,
  listInboundHandoffs,
  listMeetings,
  listMessages,
  listOutboundHandoffs,
  listTasks,
  MesaError,
  withLock,
} from '@agentmesa/core';
import type { EventEnvelope, WorkflowDecisionCommand } from '@agentmesa/protocol';
import { CreateMessageInputSchema, WorkflowDecisionCommandSchema } from '@agentmesa/protocol';
import type { MesaActor, MesaRuntimeContext } from '@agentmesa/core';
import { WorkflowEngine, decideWorkflow, listWorkflowStates } from '@agentmesa/orchestrator';
import {
  getSetupStatus,
  installMcpIntegration,
  uninstallMcpIntegration,
  setRunnerCommands,
  isIntegrationSide,
  type RunnerCommandPatch,
} from '@agentmesa/setup';
import { generateDashboardHtml } from './dashboard.js';

export interface DeskServerOptions {
  host?: string;
  sessionToken?: string;
  writeActor?: MesaActor;
}

interface StoredCommandResult {
  commandId: string;
  fingerprint: string;
  status: 'pending' | 'completed';
  accepted: true;
  duplicate: boolean;
  result?: unknown;
}

export class DeskServer {
  private readonly rootDir: string;
  private readonly requestedPort: number;
  private readonly host: string;
  private readonly sessionToken?: string;
  private readonly writeActor: MesaActor;
  private actualPort = 0;
  private server: Server | null = null;
  private readonly eventResponses = new Set<ServerResponse>();

  constructor(rootDir: string, port: number = 3456, options: DeskServerOptions = {}) {
    this.rootDir = rootDir;
    this.requestedPort = port;
    this.host = options.host ?? '127.0.0.1';
    this.sessionToken = options.sessionToken;
    this.writeActor = options.writeActor ?? {
      id: 'user:desk',
      type: 'user',
      roles: ['owner'],
      client: 'agentmesa-desk',
    };
  }

  async start(): Promise<void> {
    const readContext = this.createReadContext();

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res, readContext).catch((error) => {
          this.handleError(res, error);
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.requestedPort, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.actualPort = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const response of this.eventResponses) {
      response.end();
    }
    this.eventResponses.clear();

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  getPort(): number {
    return this.actualPort || this.requestedPort;
  }

  private createReadContext(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: this.rootDir,
      actor: {
        id: 'system:desk',
        type: 'system',
        roles: ['read_only'],
      },
    });
  }

  private createWriteContext(): MesaRuntimeContext {
    return createRuntimeContext({
      rootDir: this.rootDir,
      actor: this.writeActor,
    });
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    readContext: MesaRuntimeContext,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:${this.getPort()}`}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/') && this.sessionToken && !this.isAuthorized(req, url)) {
      this.sendError(res, 401, 'Unauthorized');
      return;
    }

    if (req.method === 'POST') {
      await this.handleWriteRequest(req, res, pathname);
      return;
    }
    if (req.method !== 'GET') {
      this.sendError(res, 405, 'Method not allowed');
      return;
    }

    if (pathname === '/') {
      this.sendHtml(res, generateDashboardHtml());
      return;
    }

    if (pathname === '/api/events') {
      this.sendJson(res, this.listEventEnvelopes(readContext, url.searchParams.get('cursor') ?? undefined, this.parseLimit(url)));
      return;
    }
    if (pathname === '/api/events/stream') {
      this.streamEvents(req, res, readContext, url.searchParams.get('cursor') ?? req.headers['last-event-id'] as string | undefined);
      return;
    }
    if (pathname === '/api/tasks') {
      this.sendJson(res, listTasks(readContext));
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      this.sendJson(res, getTask(readContext, taskMatch[1]!));
      return;
    }
    if (pathname === '/api/meetings') {
      this.sendJson(res, listMeetings(readContext));
      return;
    }

    const meetingMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
    if (meetingMatch) {
      const meeting = getMeeting(readContext, meetingMatch[1]!);
      const messages = listMessages(readContext).filter((message) =>
        meeting.tasks.some((taskId) => message.taskId === taskId),
      );
      this.sendJson(res, { ...meeting, messages });
      return;
    }
    if (pathname === '/api/artifacts') {
      this.sendJson(res, listArtifacts(readContext));
      return;
    }

    const artifactMatch = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      this.sendJson(res, getArtifact(readContext, artifactMatch[1]!));
      return;
    }
    if (pathname === '/api/agents') {
      this.sendJson(res, listAgents(readContext));
      return;
    }
    if (pathname === '/api/runs') {
      this.sendJson(res, listAgentRuns(readContext));
      return;
    }
    if (pathname === '/api/workflows') {
      this.sendJson(res, listWorkflowStates(readContext));
      return;
    }
    if (pathname === '/api/handoffs') {
      this.sendJson(res, {
        outbound: listOutboundHandoffs(readContext),
        inbound: listInboundHandoffs(readContext),
      });
      return;
    }
    if (pathname === '/api/checks') {
      this.sendJson(res, listCheckResults(readContext));
      return;
    }
    if (pathname === '/api/setup/status') {
      this.sendJson(res, getSetupStatus(this.rootDir));
      return;
    }
    if (pathname === '/api/status') {
      this.sendJson(res, {
        tasks: listTasks(readContext).length,
        meetings: listMeetings(readContext).length,
        agents: listAgents(readContext).length,
        artifacts: listArtifacts(readContext).length,
        runs: listAgentRuns(readContext).length,
        checks: listCheckResults(readContext).length,
        handoffs: listOutboundHandoffs(readContext).length + listInboundHandoffs(readContext).length,
      });
      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  private async handleWriteRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (!this.sessionToken) {
      this.sendError(res, 403, 'Write API requires a configured session token');
      return;
    }

    const writeContext = this.createWriteContext();
    if (pathname === '/api/messages') {
      const input = CreateMessageInputSchema.omit({ from: true }).parse(await this.readJsonBody(req));
      this.sendJson(res, appendMessage(writeContext, input), 201);
      return;
    }

    const decisionMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/decision$/);
    if (decisionMatch) {
      const command = WorkflowDecisionCommandSchema.parse(await this.readJsonBody(req));
      const workflowId = decisionMatch[1]!;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({
          workflowId,
          decision: command.decision,
          reason: command.reason,
          message: command.message,
        }))
        .digest('hex');
      const result = await this.executeIdempotentCommand(writeContext, command.commandId, fingerprint, () => {
        const state = decideWorkflow(writeContext, workflowId, command);
        if (state.status === 'running') {
          const continuation = setImmediate(() => {
            new WorkflowEngine(writeContext).advanceWorkflow(state).catch((error) => {
              writeContext.logger.error('Failed to resume approved workflow', {
                workflowId: state.workflowId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          });
          continuation.unref();
        }
        return state;
      });
      this.sendJson(res, result, 202);
      return;
    }

    if (pathname === '/api/setup/install' || pathname === '/api/setup/uninstall') {
      const body = await this.readJsonBody(req) as { side?: unknown };
      if (typeof body.side !== 'string' || !isIntegrationSide(body.side)) {
        throw new MesaError('VALIDATION_ERROR', 'side must be "claude" or "codex"');
      }
      const result = pathname === '/api/setup/install'
        ? installMcpIntegration(body.side)
        : uninstallMcpIntegration(body.side);
      this.sendJson(res, result, result.ok ? 200 : 502);
      return;
    }

    if (pathname === '/api/setup/runners') {
      const body = await this.readJsonBody(req) as { claudeCmd?: unknown; codexCmd?: unknown };
      const patch: RunnerCommandPatch = {};
      for (const key of ['claudeCmd', 'codexCmd'] as const) {
        const value = body[key];
        if (value === null) {
          patch[key] = null;
        } else if (typeof value === 'string') {
          patch[key] = value;
        } else if (value !== undefined) {
          throw new MesaError('VALIDATION_ERROR', `${key} must be a string or null`);
        }
      }
      this.sendJson(res, setRunnerCommands(this.rootDir, patch));
      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  private listEventEnvelopes(
    context: MesaRuntimeContext,
    cursor?: string,
    limit: number = 100,
  ): EventEnvelope[] {
    if (context.eventStore.listAfter) {
      return context.eventStore.listAfter(cursor, limit);
    }
    const events = context.eventStore.list();
    const index = cursor ? events.findIndex((event) => event.id === cursor) : -1;
    if (cursor && index === -1) {
      throw new MesaError('VALIDATION_ERROR', `Unknown event cursor: ${cursor}`);
    }
    return events.slice(index + 1, index + 1 + limit).map((event) => ({ cursor: event.id, event }));
  }

  private streamEvents(
    req: IncomingMessage,
    res: ServerResponse,
    context: MesaRuntimeContext,
    cursor?: string,
  ): void {
    const livePending = new Map<string, EventEnvelope>();
    let replaying = true;
    let closed = false;
    let pendingWrites = 0;
    let writeChain = Promise.resolve();
    let unsubscribe: () => void = () => undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      livePending.clear();
      this.eventResponses.delete(res);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);

    const writeEnvelope = async (envelope: EventEnvelope) => {
      if (closed) return;
      const writable = res.write(
        `id: ${envelope.cursor}\nevent: mesa-event\ndata: ${JSON.stringify(envelope)}\n\n`,
      );
      if (!writable) {
        await once(res, 'drain');
      }
    };

    const enqueue = (envelope: EventEnvelope) => {
      if (closed || livePending.has(envelope.cursor)) return;
      if (replaying) {
        if (livePending.size >= 2000) {
          res.destroy(new Error('SSE client is too slow'));
          cleanup();
          return;
        }
        livePending.set(envelope.cursor, envelope);
        return;
      }
      if (pendingWrites >= 2000) {
        res.destroy(new Error('SSE client is too slow'));
        cleanup();
        return;
      }
      pendingWrites += 1;
      writeChain = writeChain
        .then(() => writeEnvelope(envelope))
        .catch(() => {
          cleanup();
        })
        .finally(() => {
          pendingWrites -= 1;
        });
    };

    const start = async () => {
      unsubscribe = context.eventStore.subscribe?.(enqueue) ?? (() => undefined);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      this.eventResponses.add(res);

      let replayCursor = cursor;
      let page: EventEnvelope[] = [];
      while (!closed) {
        try {
          page = this.listEventEnvelopes(context, replayCursor, 500);
        } catch (error) {
          // A cursor persisted by an older client can outlive the event log
          // (workspace reset, log rotation). Replay from the start instead of
          // killing the stream, which would loop the client forever.
          if (replayCursor && error instanceof MesaError && error.code === 'VALIDATION_ERROR') {
            replayCursor = undefined;
            continue;
          }
          throw error;
        }
        for (const envelope of page) {
          livePending.delete(envelope.cursor);
          await writeEnvelope(envelope);
        }
        replayCursor = page.at(-1)?.cursor ?? replayCursor;
        if (page.length < 500) break;
      }

      for (const envelope of livePending.values()) {
        await writeEnvelope(envelope);
      }
      livePending.clear();
      replaying = false;

      heartbeat = setInterval(() => {
        if (closed || pendingWrites >= 2000) return;
        pendingWrites += 1;
        writeChain = writeChain
          .then(async () => {
            if (!closed && !res.write(': heartbeat\n\n')) {
              await once(res, 'drain');
            }
          })
          .catch(() => {
            cleanup();
          })
          .finally(() => {
            pendingWrites -= 1;
          });
      }, 15_000);
      heartbeat.unref();
    };

    start().catch((error) => {
      cleanup();
      if (!res.headersSent) {
        this.handleError(res, error);
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    });
  }

  private async executeIdempotentCommand(
    context: MesaRuntimeContext,
    commandId: string,
    fingerprint: string,
    execute: () => unknown,
  ): Promise<StoredCommandResult> {
    return withLock(context, `command:${commandId}`, () => {
      const path = join(context.paths.logsDir, 'commands', `${encodeURIComponent(commandId)}.json`);
      const existing = context.storage.readText(path);
      if (existing) {
        const stored = JSON.parse(existing) as StoredCommandResult;
        if (stored.fingerprint !== fingerprint) {
          throw new MesaError('VALIDATION_ERROR', `Command ID ${commandId} was already used for another request`);
        }
        if (stored.status === 'completed') {
          return { ...stored, duplicate: true };
        }
        const recovered: StoredCommandResult = {
          ...stored,
          status: 'completed',
          duplicate: true,
          result: execute(),
        };
        context.storage.writeText(path, `${JSON.stringify(recovered, null, 2)}\n`);
        return recovered;
      }
      const pending: StoredCommandResult = {
        commandId,
        fingerprint,
        status: 'pending',
        accepted: true,
        duplicate: false,
      };
      context.storage.writeText(path, `${JSON.stringify(pending, null, 2)}\n`);
      const completed: StoredCommandResult = {
        ...pending,
        status: 'completed',
        result: execute(),
      };
      context.storage.writeText(path, `${JSON.stringify(completed, null, 2)}\n`);
      return completed;
    });
  }

  private isAuthorized(req: IncomingMessage, url: URL): boolean {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const streamToken = url.pathname === '/api/events/stream'
      ? url.searchParams.get('access_token') ?? undefined
      : undefined;
    return bearer === this.sessionToken || streamToken === this.sessionToken;
  }

  private parseLimit(url: URL): number {
    const raw = url.searchParams.get('limit');
    if (raw === null) {
      return 100;
    }
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MesaError('VALIDATION_ERROR', 'limit must be an integer between 1 and 1000');
    }
    return limit;
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) {
        throw new MesaError('VALIDATION_ERROR', 'Request body exceeds 1 MiB');
      }
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
    } catch {
      throw new MesaError('VALIDATION_ERROR', 'Request body must be valid JSON');
    }
  }

  private handleError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof MesaError) {
      const status = error.code === 'POLICY_DENIED' ? 403
        : error.code.endsWith('_NOT_FOUND') ? 404
          : error.code === 'VALIDATION_ERROR' ? 400
            : 500;
      this.sendError(res, status, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = error instanceof Error && error.name === 'ZodError' ? 400
      : message.includes('not found') ? 404
        : message.startsWith('Cannot ') ? 409
          : 500;
    this.sendError(res, status, message);
  }

  private sendJson(res: ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
