/*
 * An event over the per-message limit in a sync answer is left out, and the rest
 * of the answer is taken.
 *
 * A node asks for a state sync only as it joins, and asks peers drawn at random
 * from those that offer one. JOINER boots cold with one answering stub peer and
 * no other, so the stub is the peer it asks. The stub answers the temp-message
 * request with two pending messages, one of them carrying padding past the
 * limit. It is Arcane and authenticates its link, as an unpaid message reaches
 * an Arcane node only over one.
 *
 * The padded message is a real one, owner-signed, that the node would store
 * without the limit: the padding is a field storage drops. Its verdict is
 * whichever JOINER reaches first, the answer's events left out or the message
 * stored. The other message is the canary.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pendingMessage, pendingVerdict } from '../framework/unpaid-messages.js';
import { advanceBlock } from '../framework/daemon-control.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import limits from '../framework/message-limits.cjs';

const { GOSSIP_MESSAGE_MAX_BYTES } = limits;

const ANSWERING = 0;
const JOINER = 1;

describe('an event over the per-message limit in a sync answer is left out', function () {
  let env;
  let canary;
  let oversized;
  let mark;
  const stamp = Date.now();

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      deferredNodes: 1,
      stubPeers: [ANSWERING],
      arcaneStubPeers: [ANSWERING],
      answeringSyncPeers: [ANSWERING],
    });
    canary = await buildSeedableApp({ env, name: `e2esynckept${stamp}`, instances: 1 });
    oversized = await buildSeedableApp({ env, name: `e2esyncpadded${stamp}`, instances: 1 });
    await env.stubPeerClients.get(ANSWERING).answerSyncWith({
      fluxapptempsync: [
        pendingMessage(canary),
        { ...pendingMessage(oversized), padding: 'x'.repeat(GOSSIP_MESSAGE_MAX_BYTES) },
      ],
    });

    const joiner = await env.startNode(JOINER);
    mark = joiner.getLastEventId();
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    await waitFor(
      async () => (await env.stubPeerClients.get(ANSWERING).getStats()).syncAnswersSent >= 4,
      { timeout: 240000, interval: 2000, label: 'JOINER asked the stub for all four streams, and it answered' },
    );
    // A held message is checked once the registry is built, which a processed block starts.
    await advanceBlock();
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('leaves the event over the limit out of what it stores', async function () {
    this.timeout(120000);
    const verdict = await pendingVerdict(env.clients[JOINER], oversized.hash, {
      event: 'sync:eventsDropped', matches: (d) => d.syncType === 'fluxapptempsync' && d.dropped === 1,
    }, { afterId: mark, label: 'JOINER\'s verdict on the padded message in the answer' });
    expect(verdict, JSON.stringify(verdict)).to.have.property('refused');
  });

  it('stores the rest of the answer', async function () {
    this.timeout(120000);
    const verdict = await pendingVerdict(env.clients[JOINER], canary.hash, {
      event: 'appmessage:refused', matches: (d) => d.hash === canary.hash,
    }, { afterId: mark, label: 'JOINER\'s verdict on the message within the limit' });
    expect(verdict, JSON.stringify(verdict)).to.deep.equal({ stored: true });
  });
});
