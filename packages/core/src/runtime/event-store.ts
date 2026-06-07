import type { MesaEvent } from '@agentmesa/protocol';
import type { MesaEventFilter, MesaEventStore } from './types.js';

export class InMemoryMesaEventStore implements MesaEventStore {
  private readonly events: MesaEvent[] = [];

  append(event: MesaEvent): void {
    this.events.push(event);
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
}
