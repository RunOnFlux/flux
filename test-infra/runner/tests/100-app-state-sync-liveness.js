import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { advanceBlock } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();
// nodeIp is 1-based and env.clients is 0-based, so the two are one apart. Suite
// 96 carries the same line for the same reason.
const ipOfIndex = (index) => subnet.nodeIp(index + 1);

// WHAT THIS SUITE IS FOR.
//
// A node's app-state sync needs answers from appSyncMinCompletions DISTINCT
// peers, and until this branch an empty response counted as one of them. A node
// booting beside other booting nodes could therefore ask three peers that knew
// nothing, count three empty answers as a completed survey of the network, and
// go READY believing the network held nothing - without any node having said
// anything false.
//
// The fleet here is built so that nobody can answer: every node boots together,
// none has completed its own sync, and appSyncFallbackMinutes is set high
// enough that no node can reach authority by waiting instead. The one node that
// CAN answer is held back, so the moment it joins is observable.
//
// Blocks are driven by hand. The fallback road is measured in blocks, so a
// running ticker is a second clock racing the thing under test - and it is the
// road the suite is deliberately keeping shut.
const REAL_NODES = 6;
// ORDER MATTERS. deferredNodes holds back the LAST indices of the fleet
// (test-env.js: firstDeferred = nodes - deferredNodes), so the node being held
// back has to be the highest index. Putting the stub there instead gave the
// deferred slot to a container that is not a flux node at all: the answerer
// booted with everyone else, answered them, and the fleet completed the very
// survey this suite exists to show it cannot.
// A stub that offers to answer state syncs and never does. The real nodes all
// decline and are set aside, which leaves this as the only candidate - so the
// node under test is certain to ask it, and the only thing that can free that
// slot is the slot's own deadline. No peer joins, nothing is refused.
const SILENT = REAL_NODES;
const ANSWERER = REAL_NODES + 1; // held back, and the only node that boots synced

describe('a node that cannot answer a state sync declines it', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 2,
      deferredNodes: 1,
      syncedNodes: [ANSWERER],
      stubPeers: [SILENT],
      silentSyncPeers: [SILENT],
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          // 20 blocks, and this suite drives far fewer. Without it the harness
          // default of 1 minute lets every node reach authority on its own and
          // start answering, which is the opposite of the shape being built.
          appSyncFallbackMinutes: 10,
          appSyncFallbackMinutesEnterprise: 10,
        },
      },
    });

    const booted = Array.from({ length: REAL_NODES }, (_, i) => i);
    const clients = booted.map((i) => env.clients[i]);
    for (const client of clients) await waitForDaemonReady(client);
    await Promise.all(clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    for (const client of clients) {
      await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
    }
    await env.startDiscovery(booted);
    await env.clients[0].waitForEvent('peers:added', (d) => d.total >= 2, 120000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('declines a peer it cannot answer, and the peer says which node declined', async function () {
    this.timeout(180000);

    // The refusal is published by the node being ASKED, so this is the fleet
    // telling us it knows it has nothing worth surveying.
    const refusal = await env.clients[1].waitForEvent('sync:refused', () => true, 120000);
    expect(refusal.data.peer, 'a refusal that names no peer cannot be replaced').to.be.a('string');
    expect(refusal.data.peer).to.match(/^\d+\.\d+\.\d+\.\d+:\d+$/);
  });

  it('completes nothing while every peer is still catching up', async function () {
    this.timeout(120000);

    // Every candidate declines, so no peer is ever credited. This is the
    // assertion that would have failed before the change: three empty answers
    // used to be three completions and this node would have finished its sync.
    const completed = await env.clients[0]
      .waitForEvent('ephemeralSync:allComplete', () => true, 45000)
      .then(() => true)
      .catch(() => false);

    // An absence proves nothing on its own - a dead event stream looks exactly
    // like a node that never completed. So say what DID happen first: this node
    // asked, and was turned down.
    const asked = env.clients[0].getEventBuffer().filter((e) => e.event === 'ephemeralSync:requested');
    const refused = env.clients[0].getEventBuffer().filter((e) => e.event === 'sync:refused');
    expect(asked.length, 'this node never asked anyone, so being unfinished says nothing').to.be.greaterThan(0);
    expect(refused.length + asked.length, 'no traffic at all - the stream, not the sync, is what is quiet').to.be.greaterThan(1);

    expect(completed, 'a fleet where nobody could answer still completed a survey').to.equal(false);
  });

  it('gives up on a peer that took the request and never answered', async function () {
    this.timeout(180000);

    // The real peers decline, which sets them aside, so the silent stub is what
    // is left to ask. It keeps its socket healthy - it answers pings - so
    // nothing at the transport level notices, and no completion ever arrives to
    // start a clock. Only the slot's own deadline, armed when the request was
    // sent, can end this wait.
    const silentIp = ipOfIndex(SILENT);
    const gaveUp = await env.clients[0].waitForEvent(
      'ephemeralSync:peerTimedOut',
      (d) => String(d.peer ?? '').startsWith(silentIp),
      120000,
    );

    expect(gaveUp.data.peer).to.match(new RegExp(`^${silentIp.replace(/\./g, '\\.')}:`));
    expect(gaveUp.data.reason, 'a peer that never spoke was reported as having stalled mid-answer')
      .to.equal('said nothing');
  });

  it('asks the node that can answer as soon as it joins, and credits it by name', async function () {
    this.timeout(240000);

    // Anchored: node 0 has been asking and being declined for two tests, so an
    // unanchored wait would answer from the buffer rather than from the join.
    const afterId = env.clients[0].getLastEventId();

    const answerer = await env.startNode(ANSWERER);
    await waitForDaemonReady(answerer);
    await waitForNodeStatus(answerer, (d) => d.confirmed === true, 60000);
    await env.startDiscovery([ANSWERER]);

    // No threshold edge is available here - it fired before the answerer
    // existed and the count never fell - so this can only come from the join
    // itself topping the pool back up.
    const answererIp = ipOfIndex(ANSWERER);
    const credited = await env.clients[0].waitForEvent(
      'ephemeralSync:peerComplete',
      (d) => String(d.peer ?? '').startsWith(answererIp),
      180000,
      { afterId },
    );

    expect(credited.data.peer).to.match(new RegExp(`^${answererIp.replace(/\./g, '\\.')}:`));
    expect(credited.data.syncType).to.be.oneOf(['apprunning', 'appinstalling', 'apperrors']);

    await env.clients[0].waitForEvent('ephemeralSync:allComplete', () => true, 120000, { afterId });
  });
});

// THE ARITHMETIC AT THE PRODUCTION SETTING.
//
// The fleet above runs at the harness default of one completion, where the
// pool is a single slot and "three peers" and "three answers" cannot be told
// apart. This one asks for three, which is what mainnet asks for, so the
// deficit is a number the code has to get right rather than a boolean.
describe('a state sync at the production requirement completes on three distinct peers', function () {
  let env;
  dumpLogsOnFailure(() => env);

  // Nodes 1-3 can answer from the moment they start; 0 is the node under test
  // and 4 is a spare, so there are more candidates than the requirement and
  // asking all of them would go unnoticed without the count below.
  const UNDER_TEST = 0;
  const ANSWERERS = [1, 2, 3];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      syncedNodes: ANSWERERS,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          appSyncMinCompletions: 3,
          // High enough that no node reaches authority by waiting, so every
          // completion credited below came from a peer that answered.
          appSyncFallbackMinutes: 10,
          appSyncFallbackMinutesEnterprise: 10,
        },
      },
    });
    for (const client of env.clients) await waitForDaemonReady(client);
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    for (const client of env.clients) {
      await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
    }
    await env.startDiscovery(env.clients.map((_, i) => i));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks no more peers at once than the number of answers it needs', async function () {
    this.timeout(180000);

    const client = env.clients[UNDER_TEST];
    await client.waitForEvent('ephemeralSync:requested', () => true, 120000);
    // The threshold crossing and the join that caused it are two events from
    // one call, and both reach the request path. Everything asked in that first
    // burst is one round's worth or the pool cap is not a cap.
    const asked = new Set();
    for (const event of client.getEventBuffer().filter((e) => e.event === 'ephemeralSync:requested')) {
      for (const peer of event.data.peers ?? []) asked.add(peer);
      expect(event.data.peerCount, 'one round asked more peers than the requirement').to.be.at.most(3);
    }
    expect(asked.size, 'the opening round asked more distinct peers than it needed answers').to.be.at.most(3);
  });

  it('credits three different peers, not three answers', async function () {
    this.timeout(240000);

    const client = env.clients[UNDER_TEST];
    await client.waitForEvent('ephemeralSync:allComplete', () => true, 180000);

    const credited = new Set(
      client.getEventBuffer()
        .filter((e) => e.event === 'ephemeralSync:peerComplete')
        .map((e) => e.data.peer),
    );
    expect(credited.size, 'the sync completed without three separate peers having answered').to.be.at.least(3);
    for (const peer of credited) expect(peer).to.match(/^\d+\.\d+\.\d+\.\d+:\d+$/);
  });
});
