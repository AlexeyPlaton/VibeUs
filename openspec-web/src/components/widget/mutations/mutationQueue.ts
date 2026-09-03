export interface MutationQueueOptions {
  send: (msg: any) => void;
  getRevision: () => number;
  setRevision: (r: number) => void;
  resync: () => Promise<number>;
  onError?: (err: { type: 'event.error'; event_id: string; code: string; message?: string }) => void;
}

export interface QueuedMutation {
  event_id: string;
  type: string;
  entity_id: string;
  payload: any;
}

export class WsMutationQueue {
  private options: MutationQueueOptions;
  private isConnected: boolean = false;
  private queue: QueuedMutation[] = [];
  private inFlight: QueuedMutation | null = null;
  private isResyncing: boolean = false;

  constructor(options: MutationQueueOptions) {
    this.options = options;
  }

  setConnected(connected: boolean): void {
    this.isConnected = connected;
    if (this.isConnected) {
      this.processNext();
    }
  }

  enqueue(item: { type: string; entity_id: string; payload: any }): string {
    const event_id = `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const mutation: QueuedMutation = {
      event_id,
      type: item.type,
      entity_id: item.entity_id,
      payload: item.payload
    };
    this.queue.push(mutation);
    if (this.isConnected && !this.inFlight && !this.isResyncing) {
      this.processNext();
    }
    return event_id;
  }

  private processNext(): void {
    if (!this.isConnected || this.isResyncing) return;
    if (this.inFlight) {
      this.options.send({
        type: this.inFlight.type,
        event_id: this.inFlight.event_id,
        entity_id: this.inFlight.entity_id,
        expected_revision: this.options.getRevision(),
        payload: this.inFlight.payload
      });
      return;
    }
    if (this.queue.length === 0) return;

    const next = this.queue[0];
    if (!next) return;
    this.inFlight = next;
    this.options.send({
      type: next.type,
      event_id: next.event_id,
      entity_id: next.entity_id,
      expected_revision: this.options.getRevision(),
      payload: next.payload
    });
  }

  async handleAck(ack: { type: 'event.ack'; event_id: string; revision?: number; duplicate?: boolean }): Promise<void> {
    if (!this.inFlight || this.inFlight.event_id !== ack.event_id) {
      return;
    }
    if (typeof ack.revision === 'number') {
      this.options.setRevision(ack.revision);
    }
    this.queue.shift();
    this.inFlight = null;
    this.processNext();
  }

  async handleError(err: { type: 'event.error'; event_id: string; code: string; message?: string }): Promise<void> {
    if (!this.inFlight || this.inFlight.event_id !== err.event_id) {
      return;
    }
    if (err.code === 'revision_conflict') {
      this.isResyncing = true;
      try {
        const newRev = await this.options.resync();
        this.options.setRevision(newRev);
      } finally {
        this.isResyncing = false;
      }
      if (this.isConnected && this.inFlight) {
        this.options.send({
          type: this.inFlight.type,
          event_id: this.inFlight.event_id,
          entity_id: this.inFlight.entity_id,
          expected_revision: this.options.getRevision(),
          payload: this.inFlight.payload
        });
      }
    } else {
      this.queue.shift();
      this.inFlight = null;
      this.isResyncing = true;
      try {
        const newRev = await this.options.resync();
        this.options.setRevision(newRev);
      } catch (e) {
      } finally {
        this.isResyncing = false;
      }
      if (this.options.onError) {
        this.options.onError(err);
      }
      this.processNext();
    }
  }
}
