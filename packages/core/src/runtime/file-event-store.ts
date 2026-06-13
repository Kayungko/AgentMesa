import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MesaEvent } from '@agentmesa/protocol';
import { MesaError } from '../errors.js';
import type { MesaEventFilter, MesaEventStore } from './types.js';

export class FileEventStore implements MesaEventStore {
  private readonly filePath: string;

  constructor(eventsDir: string) {
    this.filePath = join(eventsDir, 'events.jsonl');
  }

  append(event: MesaEvent): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
  }

  list(filter?: MesaEventFilter): MesaEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const lines = readFileSync(this.filePath, 'utf-8').split('\n');
    const events: MesaEvent[] = [];

    for (const line of lines) {
      if (line === '') continue;
      try {
        events.push(JSON.parse(line) as MesaEvent);
      } catch {
        throw new MesaError(
          'STORAGE_ERROR',
          `Corrupted event line in ${this.filePath}: ${line.slice(0, 120)}`,
        );
      }
    }

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
}
