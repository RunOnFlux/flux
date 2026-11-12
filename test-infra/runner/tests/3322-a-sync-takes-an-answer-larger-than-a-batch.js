/*
 * A joining node takes answers holding more than one batch of temp messages from peers it
 * asks at once: none is blamed while it checks them, the budget does not end the sync, and
 * its temp messages then equal its peers', each stored once.
 *
 * 2,200 messages against a batch of 2,000, and every one is checked in full, so the work
 * outlasts the stall clock of a 60 s budget (15 s) many times over. Two peers send the same
 * messages at once, which is what stored a message twice.
 *
 * The messages are seeded as a peer stores them, because a real registration through the
 * door takes a quorum of checks per message and 2,200 of them do not fit a suite. Their
 * specifications, hashes and signatures are real, and the node under test checks them.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildTempMessages } from '../framework/seed-helper.js';
import { dbClient } from '../framework/db-client.js';
import { waitForDaemonReady, waitForNodeStatus } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const BUDGET_MS = 60000;
const MESSAGES = 2200;
const TTL_S = 1800;
const SUBJECT = 4;
const ANSWERERS = [0, 3];
const BOOTED = [0, 1, 2, 3];

describe('a sync takes an answer larger than a batch', function () {
  let env;
  let subject;
  let mark;
  let seeded;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      deferredNodes: 1,
      syncedNodes: ANSWERERS,
      configOverrides: {
        fluxapps: { syncTimeoutMs: BUDGET_MS, appSyncMinCompletions: ANSWERERS.length, tempMsgTtlS: TTL_S },
      },
    });
    await bootAndPeer(env);

    const rows = await buildTempMessages(MESSAGES, TTL_S * 1000);
    seeded = rows.map((row) => row.hash).sort();
    await Promise.all(ANSWERERS.map((index) => dbClient(index + 1).seedTempMessages(rows)));

    await env.holdOutPendingNode(SUBJECT, BOOTED);
    subject = await env.startNode(SUBJECT);
    await waitForDaemonReady(subject);
    await waitForNodeStatus(subject, (d) => d.confirmed === true, 60000);
    mark = subject.getLastEventId();
    await env.releasePendingNode(SUBJECT, BOOTED);
    await env.startDiscovery([SUBJECT]);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('completes the sync with no peer blamed and the budget unspent', async function () {
    this.timeout(300000);
    await subject.waitForEvent('ephemeralSync:allComplete', () => true, 280000, { afterId: mark });

    const seen = (name) => subject.getEventBuffer().filter((e) => e.event === name && e.id > mark);
    expect(seen('ephemeralSync:requested').length, 'nobody was asked').to.be.above(0);
    expect(seen('ephemeralSync:peerTimedOut'), 'an honest peer was blamed for this node\'s work').to.deep.equal([]);
    expect(seen('ephemeralSync:budgetSpent'), 'the budget ended a sync with every answer in').to.deep.equal([]);
  });

  it('holds what its peers hold, each message once', async function () {
    const held = await dbClient(SUBJECT + 1).tempMessageHashes();
    expect(await dbClient(SUBJECT + 1).heldMessageHashes(), 'complete with messages unchecked').to.deep.equal([]);
    expect(new Set(held).size, 'a message was stored twice').to.equal(held.length);
    expect(held).to.deep.equal(seeded);
  });
});
