import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unwatchFile,
  watchFile,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { MesaEventSchema } from '@agentmesa/protocol';
import type { EventEnvelope, MesaEvent } from '@agentmesa/protocol';
import { MesaError } from '../errors.js';
import type { MesaEventFilter, MesaEventListener, MesaEventStore } from './types.js';

interface FileSubscription {
  listeners: Set<MesaEventListener>;
  cursor?: string;
  reading: boolean;
}

const subscriptionsByFile = new Map<string, FileSubscription>();

export class FileEventStore implements MesaEventStore {
  private readonly filePath: string;

  constructor(eventsDir: string) {
    this.filePath = join(eventsDir, 'events.jsonl');
  }

  append(event: MesaEvent): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    this.sync();
    this.publishExternal();
  }

  list(filter?: MesaEventFilter): MesaEvent[] {
    const events = this.readEvents();
    if (!filter) {
      return events;
    }

    return events.filter((event) => {
      return (
        (filter.meetingId === undefined || event.meetingId === filter.meetingId) &&
        (filter.type === undefined || event.type === filter.type) &&
        (filter.streamId === undefined || event.streamId === filter.streamId) &&
        (filter.streamType === undefined || event.streamType === filter.streamType) &&
        (filter.actor === undefined || event.actor === filter.actor)
      );
    });
  }

  listAfter(cursor?: string, limit: number = 100): EventEnvelope[] {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new MesaError('VALIDATION_ERROR', 'Event limit must be a positive integer');
    }
    const events = this.readEvents();
    let start = 0;
    if (cursor !== undefined) {
      const index = events.findIndex((event) => event.id === cursor);
      if (index === -1) {
        throw new MesaError('VALIDATION_ERROR', `Unknown event cursor: ${cursor}`);
      }
      start = index + 1;
    }
    return events.slice(start, start + limit).map((event) => ({ cursor: event.id, event }));
  }

  subscribe(listener: MesaEventListener): () => void {
    let subscription = subscriptionsByFile.get(this.filePath);
    if (!subscription) {
      const events = this.readEvents();
      subscription = {
        listeners: new Set(),
        cursor: events.at(-1)?.id,
        reading: false,
      };
      subscriptionsByFile.set(this.filePath, subscription);
      watchFile(this.filePath, { interval: 250, persistent: false }, () => {
        this.publishExternal();
      });
    }
    subscription.listeners.add(listener);

    return () => {
      const current = subscriptionsByFile.get(this.filePath);
      current?.listeners.delete(listener);
      if (current?.listeners.size === 0) {
        unwatchFile(this.filePath);
        subscriptionsByFile.delete(this.filePath);
      }
    };
  }

  private publishExternal(): void {
    const subscription = subscriptionsByFile.get(this.filePath);
    if (!subscription || subscription.reading) {
      return;
    }
    subscription.reading = true;
    try {
      let page: EventEnvelope[];
      do {
        page = this.listAfter(subscription.cursor, 500);
        for (const envelope of page) {
          subscription.cursor = envelope.cursor;
          this.notify(subscription, envelope);
        }
      } while (page.length === 500);
    } finally {
      subscription.reading = false;
    }
  }

  private notify(subscription: FileSubscription, envelope: EventEnvelope): void {
    for (const listener of subscription.listeners) {
      try {
        listener(envelope);
      } catch {
        // Notification failures cannot roll back an event that is already durable.
      }
    }
  }

  private readEvents(): MesaEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const lines = readFileSync(this.filePath, 'utf-8').split('\n');
    const events: MesaEvent[] = [];

    for (const line of lines) {
      if (line === '') continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new MesaError(
          'STORAGE_ERROR',
          `Corrupted event line in ${this.filePath}: invalid JSON — ${line.slice(0, 120)}`,
        );
      }
      const result = MesaEventSchema.safeParse(raw);
      if (!result.success) {
        throw new MesaError(
          'STORAGE_ERROR',
          `Invalid event in ${this.filePath}: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
        );
      }
      events.push(result.data);
    }

    return events;
  }

  private sync(): void {
    try {
      const fd = openSync(this.filePath, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch {
      // appendFileSync already flushed userspace buffers; retry fsync on the next append.
    }
  }
}
