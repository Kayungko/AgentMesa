import type { EventEnvelope, MesaEvent } from '@agentmesa/protocol';
import type { MesaEventFilter, MesaEventListener, MesaEventStore } from './types.js';
import { MesaError } from '../errors.js';

export class InMemoryMesaEventStore implements MesaEventStore {
  private readonly events: MesaEvent[] = [];
  private readonly listeners = new Set<MesaEventListener>();

  append(event: MesaEvent): void {
    this.events.push(event);
    const envelope = { cursor: event.id, event };
    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch {
        // Notification failures cannot roll back an event that is already stored.
      }
    }
  }

  list(filter?: MesaEventFilter): MesaEvent[] {
    if (!filter) {
      return [...this.events];
    }

    return this.events.filter((event) => {
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
    let start = 0;
    if (cursor !== undefined) {
      const index = this.events.findIndex((event) => event.id === cursor);
      if (index === -1) {
        throw new MesaError('VALIDATION_ERROR', `Unknown event cursor: ${cursor}`);
      }
      start = index + 1;
    }
    return this.events.slice(start, start + limit).map((event) => ({ cursor: event.id, event }));
  }

  subscribe(listener: MesaEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
