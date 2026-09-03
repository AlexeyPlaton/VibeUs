function createEventId() {
  return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class CloudMutationQueue {
  constructor({
    send,
    resync,
    onError = () => {},
    onRevision = () => {},
  }) {
    if (typeof send !== 'function') {
      throw new TypeError('CloudMutationQueue requires send()');
    }

    if (typeof resync !== 'function') {
      throw new TypeError('CloudMutationQueue requires resync()');
    }

    this.send = send;
    this.resync = resync;
    this.onError = onError;
    this.onRevision = onRevision;

    this.queue = [];
    this.inFlight = null;
    this.connected = false;
    this.resyncing = false;
    this._revision = 0;
  }

  get revision() {
    return this._revision;
  }

  get size() {
    return this.queue.length;
  }

  get inFlightEventId() {
    return this.inFlight?.event_id ?? null;
  }

  setRevision(revision) {
    if (
      typeof revision !== 'number' ||
      !Number.isFinite(revision) ||
      revision < 0
    ) {
      return;
    }

    // Project revision is monotonic. A stale packet must never rewind us.
    if (revision >= this._revision) {
      this._revision = revision;
      this.onRevision(this._revision);
    }
  }

  setConnected(connected) {
    this.connected = Boolean(connected);

    if (!this.connected) {
      // Keep queue head and event_id, but allow resend on reconnect.
      this.inFlight = null;
      return;
    }

    this.processNext();
  }

  enqueue(mutation) {
    const item = {
      ...mutation,
      event_id: mutation.event_id || createEventId(),
    };

    // expected_revision belongs to a SEND attempt, not to persistent intent.
    delete item.expected_revision;

    this.queue.push(item);
    this.processNext();

    return item.event_id;
  }

  processNext() {
    if (
      !this.connected ||
      this.resyncing ||
      this.inFlight ||
      this.queue.length === 0
    ) {
      return;
    }

    const head = this.queue[0];
    this.inFlight = head;

    const {
      _reconcileAfterAck,
      ...wireMutation
    } = head;

    try {
      this.send({
        ...wireMutation,
        expected_revision: this._revision,
      });
    } catch (error) {
      // Socket may have disappeared between readyState check and send().
      // Preserve head intent for reconnect.
      this.inFlight = null;
      this.connected = false;

      this.onError(
        {
          type: 'event.error',
          event_id: head.event_id,
          code: 'send_failed',
          message: error?.message || String(error),
        },
        head,
      );
    }
  }

  async resyncAuthoritative() {
    this.resyncing = true;

    try {
      const revision = await this.resync();

      if (
        typeof revision !== 'number' ||
        !Number.isFinite(revision)
      ) {
        throw new Error(
          'Authoritative resync did not return a numeric revision',
        );
      }

      this.setRevision(revision);
      return revision;
    } finally {
      this.resyncing = false;
    }
  }

  async handleBoardRefresh(message = {}) {
    if (typeof message.revision === 'number') {
      this.setRevision(message.revision);
    }

    await this.resyncAuthoritative();

    if (!this.inFlight) {
      this.processNext();
    }
  }

  async handleAck(ack) {
    if (
      !this.inFlight ||
      !ack ||
      ack.event_id !== this.inFlight.event_id
    ) {
      // Foreign/stale ACK cannot mutate current queue.
      return false;
    }

    const completed = this.inFlight;

    if (typeof ack.revision === 'number') {
      this.setRevision(ack.revision);
    }

    this.queue.shift();
    this.inFlight = null;

    // A revision conflict required us to temporarily restore an
    // authoritative pre-intent snapshot before retrying.
    // Reconcile once again after successful ACK so local files reflect
    // the mutation that actually reached Cloud.
    if (completed._reconcileAfterAck) {
      try {
        await this.resyncAuthoritative();
      } catch (error) {
        this.onError(
          {
            type: 'event.error',
            event_id: completed.event_id,
            code: 'post_ack_resync_failed',
            message: error?.message || String(error),
          },
          completed,
        );
      }
    }

    this.processNext();
    return true;
  }

  async handleError(error) {
    if (
      !this.inFlight ||
      !error ||
      error.event_id !== this.inFlight.event_id
    ) {
      // Never let a stale/foreign error remove another mutation.
      return false;
    }

    const failed = this.inFlight;

    if (error.code === 'revision_conflict') {
      // IMPORTANT:
      // do NOT shift queue.
      // do NOT create a new event_id.
      failed._reconcileAfterAck = true;
      this.inFlight = null;

      try {
        await this.resyncAuthoritative();
      } catch (resyncError) {
        this.onError(
          {
            ...error,
            code: 'revision_resync_failed',
            message:
              resyncError?.message ||
              String(resyncError),
          },
          failed,
        );

        return false;
      }

      // Same head, same event_id, fresh expected_revision.
      this.processNext();
      return true;
    }

    // Non-retryable mutation error:
    // discard only the current head.
    this.queue.shift();
    this.inFlight = null;

    try {
      await this.resyncAuthoritative();
    } catch (resyncError) {
      this.onError(
        {
          ...error,
          resync_error:
            resyncError?.message ||
            String(resyncError),
        },
        failed,
      );

      return false;
    }

    this.onError(error, failed);
    this.processNext();

    return true;
  }
}
