import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CloudMutationQueue,
} from '../cloud-mutation-queue.js';


test(
  'revision_conflict resyncs and retries SAME event_id',
  async () => {
    const sent = [];
    const resyncRevisions = [5, 6];

    const queue = new CloudMutationQueue({
      send: (message) => sent.push({ ...message }),
      resync: async () => resyncRevisions.shift(),
    });

    queue.setRevision(4);
    queue.setConnected(true);

    const eventId = queue.enqueue({
      type: 'ticket.checklist.change',
      entity_id: 'ticket-1',
      payload: {
        key: 'backend_tests',
        is_done: true,
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].event_id, eventId);
    assert.equal(sent[0].expected_revision, 4);

    await queue.handleError({
      type: 'event.error',
      event_id: eventId,
      code: 'revision_conflict',
    });

    assert.equal(
      sent.length,
      2,
      'mutation must be retried',
    );

    assert.equal(
      sent[1].event_id,
      eventId,
      'retry MUST keep the same event_id',
    );

    assert.equal(
      sent[1].expected_revision,
      5,
      'retry must use authoritative revision',
    );

    await queue.handleAck({
      type: 'event.ack',
      event_id: eventId,
      revision: 6,
    });

    assert.equal(queue.size, 0);
    assert.equal(queue.revision, 6);
  },
);


test(
  'foreign stale event.error cannot drop current head',
  async () => {
    const sent = [];
    let resyncCount = 0;

    const queue = new CloudMutationQueue({
      send: (message) => sent.push({ ...message }),
      resync: async () => {
        resyncCount += 1;
        return 10;
      },
    });

    queue.setRevision(9);
    queue.setConnected(true);

    const eventId = queue.enqueue({
      type: 'ticket.status.change',
      entity_id: 'ticket-1',
      payload: { status: 'review' },
    });

    const handled = await queue.handleError({
      type: 'event.error',
      event_id: 'some-other-event',
      code: 'validation_error',
    });

    assert.equal(handled, false);
    assert.equal(queue.size, 1);
    assert.equal(queue.inFlightEventId, eventId);
    assert.equal(resyncCount, 0);
  },
);


test(
  'disconnect keeps intent and reconnect resends same event_id',
  () => {
    const sent = [];

    const queue = new CloudMutationQueue({
      send: (message) => sent.push({ ...message }),
      resync: async () => 5,
    });

    queue.setRevision(2);
    queue.setConnected(true);

    const eventId = queue.enqueue({
      type: 'ticket.status.change',
      entity_id: 'ticket-2',
      payload: { status: 'review' },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].expected_revision, 2);

    queue.setConnected(false);

    // Simulate authoritative reconnect snapshot.
    queue.setRevision(3);
    queue.setConnected(true);

    assert.equal(sent.length, 2);
    assert.equal(sent[1].event_id, eventId);
    assert.equal(sent[1].expected_revision, 3);
  },
);


test(
  'board.refresh performs authoritative resync before next mutation',
  async () => {
    const sent = [];

    const queue = new CloudMutationQueue({
      send: (message) => sent.push({ ...message }),
      resync: async () => 12,
    });

    queue.setRevision(10);

    await queue.handleBoardRefresh({
      type: 'board.refresh',
      revision: 11,
    });

    assert.equal(queue.revision, 12);

    queue.setConnected(true);

    queue.enqueue({
      type: 'ticket.checklist.change',
      entity_id: 'ticket-3',
      payload: {
        key: 'frontend_tests',
        is_done: true,
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].expected_revision, 12);
  },
);


test(
  'both CLI sync paths consume board.refresh through shared queue',
  () => {
    const indexSource = fs.readFileSync(
      new URL('../index.js', import.meta.url),
      'utf8',
    );

    const tunnelSource = fs.readFileSync(
      new URL('../tunnel.js', import.meta.url),
      'utf8',
    );

    for (const [name, source] of [
      ['index.js', indexSource],
      ['tunnel.js', tunnelSource],
    ]) {
      assert.match(
        source,
        /CloudMutationQueue/,
        `${name} must use shared CloudMutationQueue`,
      );

      assert.match(
        source,
        /board\.refresh/,
        `${name} must handle board.refresh`,
      );

      assert.match(
        source,
        /handleBoardRefresh/,
        `${name} must resync on board.refresh`,
      );

      assert.match(
        source,
        /handleError/,
        `${name} must delegate event.error semantics`,
      );
    }
  },
);
