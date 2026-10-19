import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitFor,
} from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { failWrites } from '../framework/mongo-control.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node joining the network asks a peer for the network's app state, and the peer
// answers in several messages, only the last saying it is done. Here the joining
// node's database fails the write of the first message, and the node must not
// count that peer as having answered: it ends the request and asks another peer.
//
// The harness keeps one sync request open at a time (appSyncMinCompletions), so a
// peer counted despite the failed write leaves one peer asked, and a peer replaced
// leaves two. syncAnswerBatchSize 2 splits an answer of a few running-app events
// into several messages, and a long locationTtlS keeps the fleet from announcing
// again while the node syncs, so the only running-app writes it makes then are the
// answer's.

const ANSWER_BATCH = 2;
const NODES = 6;
const JOINING = NODES - 1;
// what the peers hold when the node joins: more events than one message carries
const ANSWERED_EVENTS = ANSWER_BATCH + 1;
// a peer's request ended for any of these reasons is replaced too, and is not this
const OTHER_ENDINGS = ['ephemeralSync:peerTimedOut', 'ephemeralSync:peerDisconnected', 'ephemeralSync:peerUnverified', 'sync:refused'];

function step(what) {
  console.log(`# 3304 ${new Date().toISOString()} ${what}`);
}

describe('a sync answer the node cannot record is not counted', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2esyncwrite${Date.now()}`;
  let release;
  let joining;
  let eventsHeld;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      deferredNodes: 1,
      tickerAutostart: false,
      configOverrides: { fluxapps: { syncAnswerBatchSize: ANSWER_BATCH, locationTtlS: 1800 } },
    });
    await bootAndPeer(env);
    await seedSimpleApp(env, appName);
    await waitFor(async () => (await dbClient(1).appStateEvents({ type: 'apprunning' })).length >= ANSWERED_EVENTS, {
      timeout: 180000, interval: 2000, label: 'the peers hold more running-app events than one message carries',
    });
    eventsHeld = (await dbClient(1).appStateEvents({ type: 'apprunning' })).length;

    step('arming the joining node\'s first location write to fail');
    release = await failWrites(JOINING + 1, 'globalzelapps', 'zelappslocation', { times: 1 });
    joining = await env.startNode(JOINING);
    await waitForDaemonReady(joining);
    await waitForNodeStatus(joining, (d) => d.confirmed === true, 60000);
    await joining.waitForEvent('ephemeralSync:allComplete', () => true, 180000);
    step('synced');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('was answered in more than one message', function () {
    expect(eventsHeld, 'the answer fits one message, so no early message could fail').to.be.above(ANSWER_BATCH);
  });

  it('had one of its location writes refused by the database', async function () {
    const failed = await release();
    release = null;
    expect(failed, 'the database failed none of the joining node\'s writes, so nothing below was tested').to.equal(1);
  });

  it('asks another peer in place of the one whose answer it could not record', function () {
    const asked = new Set(joining.getEventBuffer()
      .filter((e) => e.event === 'ephemeralSync:requested')
      .flatMap((e) => e.data.peers));
    const otherEndings = joining.getEventBuffer().filter((e) => OTHER_ENDINGS.includes(e.event));
    expect(otherEndings, 'a request ended for another reason, so a second peer proves nothing').to.deep.equal([]);
    expect(asked.size, 'the peer whose answer was not recorded was counted, and nobody else was asked').to.equal(2);
  });

  it('names that peer, and never counts it', function () {
    const events = joining.getEventBuffer();
    const failedAt = events.find((e) => e.event === 'ephemeralSync:peerWriteFailed');
    expect(failedAt, 'the node said nothing about the answer it could not record').to.not.equal(undefined);
    const counted = events.filter((e) => e.event === 'ephemeralSync:peerComplete' && e.data.peer === failedAt.data.peer);
    expect(counted, 'the peer whose answer was not recorded was counted').to.deep.equal([]);
  });
});
