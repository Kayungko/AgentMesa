import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createWorkspacePaths,
  listTasks,
  getTask,
  listMeetings,
  getMeeting,
  listMessages,
  listArtifacts,
  getArtifact,
  listAgents,
} from '@agentmesa/core';
import type { MesaWorkspacePaths } from '@agentmesa/core';
import { MesaError } from '@agentmesa/core';
import { generateDashboardHtml } from './dashboard.js';

export class DeskServer {
  private readonly rootDir: string;
  private requestedPort: number;
  private actualPort: number = 0;
  private server: Server | null = null;

  constructor(rootDir: string, port: number = 3456) {
    this.rootDir = rootDir;
    this.requestedPort = port;
  }

  async start(): Promise<void> {
    const paths = createWorkspacePaths(this.rootDir);

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res, paths).catch((err) => {
          this.sendError(res, 500, err instanceof Error ? err.message : 'Internal error');
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.requestedPort, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.actualPort = addr.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
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

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    paths: MesaWorkspacePaths
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method !== 'GET') {
      this.sendError(res, 405, 'Method not allowed');
      return;
    }

    // Dashboard HTML
    if (pathname === '/') {
      this.sendHtml(res, generateDashboardHtml());
      return;
    }

    // API routes
    if (pathname === '/api/tasks') {
      const tasks = listTasks(paths);
      this.sendJson(res, tasks);
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      try {
        const task = getTask(paths, taskMatch[1]!);
        this.sendJson(res, task);
      } catch (err) {
        if (err instanceof MesaError && err.code === 'TASK_NOT_FOUND') {
          this.sendError(res, 404, err.message);
        } else {
          throw err;
        }
      }
      return;
    }

    if (pathname === '/api/meetings') {
      const meetings = listMeetings(paths);
      this.sendJson(res, meetings);
      return;
    }

    const meetingMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
    if (meetingMatch) {
      try {
        const meeting = getMeeting(paths, meetingMatch[1]!);
        const messages = listMessages(paths).filter((m) => {
          return meeting.tasks.some((taskId) => m.taskId === taskId);
        });
        this.sendJson(res, { ...meeting, messages });
      } catch (err) {
        if (err instanceof MesaError && err.code === 'MEETING_NOT_FOUND') {
          this.sendError(res, 404, err.message);
        } else {
          throw err;
        }
      }
      return;
    }

    if (pathname === '/api/artifacts') {
      const artifacts = listArtifacts(paths);
      this.sendJson(res, artifacts);
      return;
    }

    const artifactMatch = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      try {
        const artifact = getArtifact(paths, artifactMatch[1]!);
        this.sendJson(res, artifact);
      } catch (err) {
        if (err instanceof MesaError && err.code === 'ARTIFACT_NOT_FOUND') {
          this.sendError(res, 404, err.message);
        } else {
          throw err;
        }
      }
      return;
    }

    if (pathname === '/api/agents') {
      const agents = listAgents(paths);
      this.sendJson(res, agents);
      return;
    }

    if (pathname === '/api/status') {
      const tasks = listTasks(paths);
      const meetings = listMeetings(paths);
      const agents = listAgents(paths);
      const artifacts = listArtifacts(paths);

      this.sendJson(res, {
        tasks: tasks.length,
        meetings: meetings.length,
        agents: agents.length,
        artifacts: artifacts.length,
      });
      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  private sendJson(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
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
