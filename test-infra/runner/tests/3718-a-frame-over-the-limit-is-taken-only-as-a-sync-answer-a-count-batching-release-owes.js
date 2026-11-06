/*
 * A frame over the frame limit is taken only as a sync answer a release that
 * batches by count alone owes this node. From that peer at any other time, and
 * from a peer that batches by bytes at any time, it closes the connection
 * unparsed.
 *
 * JOINER boots cold with one answering stub peer and no other, so the stub is the
 * peer it asks. The answer is two pending messages, each under the per-message
 * limit and together over the frame limit, which only a sender batching by count
 * can produce. A stub peer that does not authenticate links stands for an older
 * release, and JOINER is legacy so that it stores an unpaid message from it. An
 * Arcane stub claims the capability that says it batches by bytes.
 *
 * The padding is a field storage drops, so each message is one the node would
 * store at any size.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pendingMessage, pendingMessageOn, pendingVerdict } from '../framework/unpaid-messages.js';
import { advanceBlock } from '../framework/daemon-control.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import limits from '../framework/message-limits.cjs';

const { GOSSIP_MESSAGE_MAX_BYTES, PEER_FRAME_MAX_BYTES } = limits;

const ANSWERING = 0;
const JOINER = 1;
const PADDING = 'x'.repeat(GOSSIP_MESSAGE_MAX_BYTES - (64 * 1024));
const overTheLimit = (d, stub) => d.ip === stub.ip && d.reason === 'frameLimit';

describe('a frame over the limit is taken only as a sync answer a count-batching release owes', function () {
  const stamp = Date.now();

  // Boots JOINER into an answer of two padded messages, and returns what it needs.
  async function joinThroughAnAnswerOverTheLimit(hookCtx, label, fleet) {
    const env = await createTestEnv({
      hookCtx, nodes: 2, deferredNodes: 1, stubPeers: [ANSWERING], answeringSyncPeers: [ANSWERING], ...fleet,
    });
    const apps = await Promise.all(['a', 'b'].map((part) => buildSeedableApp({ env, name: `e2eframe${label}${part}${stamp}`, instances: 1 })));
    const stub = env.stubPeerClients.get(ANSWERING);
    await stub.answerSyncWith({
      fluxapptempsync: apps.map((app) => ({ ...pendingMessage(app), padding: PADDING })),
    });
    expect((PADDING.length * apps.length), 'the answer is over the frame limit').to.be.above(PEER_FRAME_MAX_BYTES);

    const joiner = await env.startNode(JOINER);
    const mark = joiner.getLastEventId();
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    // A held message is checked once the registry is built, which a processed block starts.
    await advanceBlock();
    return {
      env, apps, stub, joiner, mark,
    };
  }

  describe('from a release that batches by count', function () {
    let fleet;

    dumpLogsOnFailure(() => fleet?.env);

    before(async function () {
      this.timeout(600000);
      fleet = await joinThroughAnAnswerOverTheLimit(this, 'count', { legacyNodes: [JOINER] });
      const { stub } = fleet;
      await waitFor(async () => (await stub.getStats()).syncAnswersSent >= 4, {
        timeout: 240000, interval: 2000, label: 'JOINER asked the stub for all four streams, and it answered',
      });
    });

    after(async function () {
      this.timeout(60000);
      await fleet?.env?.teardown();
    });

    it('takes a sync answer it asked for, over the limit', async function () {
      this.timeout(120000);
      const { apps, stub, joiner, mark } = fleet;
      for (const app of apps) {
        // eslint-disable-next-line no-await-in-loop
        const verdict = await pendingVerdict(joiner, app.hash, {
          event: 'peers:frameDropped', matches: (d) => overTheLimit(d, stub),
        }, { afterId: mark, label: `JOINER's verdict on ${app.name} in the answer` });
        expect(verdict, JSON.stringify(verdict)).to.deep.equal({ stored: true });
      }
    });

    // Last: the connection it closes is the only one JOINER has.
    it('closes on the same size from that peer when it owes nothing', async function () {
      this.timeout(300000);
      const { env, stub, joiner, mark: joined } = fleet;
      await joiner.waitForEvent('ephemeralSync:allComplete', () => true, 120000, { afterId: joined });
      const app = await buildSeedableApp({ env, name: `e2eframeafter${stamp}`, instances: 1 });
      const mark = joiner.getLastEventId();

      await stub.broadcast({ ...pendingMessage(app), padding: 'x'.repeat(PEER_FRAME_MAX_BYTES) });

      const dropped = await joiner.waitForEvent('peers:frameDropped', (d) => overTheLimit(d, stub), 120000, { afterId: mark });
      expect(dropped.data.type, 'a frame over the limit is not parsed to name its type').to.equal(null);
      await joiner.waitForEvent('peers:removed', (d) => d.ip === stub.ip, 60000, { afterId: mark });
    });
  });

  describe('from a peer that batches by bytes', function () {
    let fleet;

    dumpLogsOnFailure(() => fleet?.env);

    before(async function () {
      this.timeout(600000);
      fleet = await joinThroughAnAnswerOverTheLimit(this, 'bytes', { arcaneStubPeers: [ANSWERING] });
    });

    after(async function () {
      this.timeout(60000);
      await fleet?.env?.teardown();
    });

    it('closes on a sync answer it asked for, over the limit, and stores none of it', async function () {
      this.timeout(300000);
      const { apps, stub, joiner, mark } = fleet;

      await joiner.waitForEvent('peers:frameDropped', (d) => overTheLimit(d, stub), 240000, { afterId: mark });
      await joiner.waitForEvent('peers:removed', (d) => d.ip === stub.ip, 60000, { afterId: mark });

      const held = await Promise.all(apps.map((app) => pendingMessageOn(joiner, app.hash)));
      expect(held, 'nothing of the answer was taken').to.deep.equal([null, null]);
    });
  });
});
