/*
 * A joining node keeps what its peers answer unchecked until its registry is built, and that
 * wait is never time a peer is blamed for. Its temp messages then equal its peers'.
 *
 * The rebuild is held past the budget, so without the hold the answers are checked against the
 * old registry and the sync completes before the registry is ready; and if the budget ran on,
 * the attempt would end with every answer already in.
 *
 * The fixture's messages are real registrations through a node's own door, left unpaid, so
 * they stay temp messages on every peer. A batch of two thousand is not built here: what makes
 * a large answer slow is this node's work, and the held rebuild stands in for that wait.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { dbClient } from '../framework/db-client.js';
import { nodeKey } from '../framework/keys.js';
import {
  assertNoEvent, waitFor, waitForDaemonReady, waitForNodeStatus,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const BEFORE_REBUILD = 'appSync:beforeRebuild';
const BUDGET_MS = 60000;
const MESSAGES = 3;
const SUBJECT = 4;
const REGISTRAR = 2;
const ANSWERERS = [1, 2, 3];
const BOOTED = [0, 1, 2, 3];

describe('a sync keeps its peers while the registry is rebuilt', function () {
  let env;
  let subject;
  let mark;
  const registered = [];
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      deferredNodes: 1,
      syncedNodes: ANSWERERS,
      configOverrides: { fluxapps: { syncTimeoutMs: BUDGET_MS } },
    });
    await bootAndPeer(env);

    for (let i = 0; i < MESSAGES; i += 1) {
      const spec = buildAppSpec({ name: `e2ehold${i}${Date.now()}` });
      const result = await registerApp(env.clients[REGISTRAR].url, nodeKey(REGISTRAR + 1), spec);
      expect(result.status, JSON.stringify(result).slice(0, 300)).to.equal('success');
      registered.push(result.data);
    }
    await Promise.all(ANSWERERS.map((index) => waitFor(
      async () => (await dbClient(index + 1).tempMessageCount()) === MESSAGES,
      { timeout: 60000, interval: 1000, label: `peer ${index} holds the registrations` },
    )));

    await env.holdOutPendingNode(SUBJECT, BOOTED);
    subject = await env.startNode(SUBJECT);
    await waitForDaemonReady(subject);
    await subject.holdCheckpoint(BEFORE_REBUILD);
    await waitForNodeStatus(subject, (d) => d.confirmed === true, 60000);
    mark = subject.getLastEventId();
    await env.releasePendingNode(SUBJECT, BOOTED);
    await env.startDiscovery([SUBJECT]);
  });

  after(async function () {
    this.timeout(60000);
    await subject?.releaseCheckpoint(BEFORE_REBUILD).catch(() => {});
    await env?.teardown();
  });

  const events = (name) => subject.getEventBuffer().filter((e) => e.event === name && e.id > mark);

  it('counts each peer once what it sent is kept, with nothing checked', async function () {
    this.timeout(120000);
    await waitFor(async () => new Set(events('ephemeralSync:peerComplete')
      .filter((e) => e.data.syncType === 'apptemp').map((e) => e.data.peer)).size >= ANSWERERS.length, {
      timeout: 90000, interval: 500, label: 'every asked peer answered the temp stream',
    });
    expect(await dbClient(SUBJECT + 1).tempMessageCount(), 'a message was checked against an unbuilt registry').to.equal(0);
    expect(await dbClient(SUBJECT + 1).heldMessageHashes()).to.have.members(registered);
  });

  it('blames no peer and spends no budget while it waits for its own registry', async function () {
    this.timeout(BUDGET_MS * 2 + 60000);
    expect(events('ephemeralSync:requested').length, 'nobody was asked, so a quiet node says nothing').to.be.above(0);
    await assertNoEvent(subject, 'ephemeralSync:budgetSpent', () => true, BUDGET_MS + 5000, { afterId: mark });

    expect(events('ephemeralSync:peerTimedOut'), 'an honest peer was blamed for this node\'s wait').to.deep.equal([]);
    expect(events('ephemeralSync:allComplete'), 'complete before what it was told was checked').to.deep.equal([]);
  });

  it('checks what it holds once the registry is built, and then holds what its peers hold', async function () {
    this.timeout(120000);
    await subject.releaseCheckpoint(BEFORE_REBUILD);
    await subject.waitForEvent('ephemeralSync:allComplete', () => true, 90000, { afterId: mark });

    expect(await dbClient(SUBJECT + 1).heldMessageHashes()).to.deep.equal([]);
    const held = await dbClient(SUBJECT + 1).tempMessageHashes();
    expect(held).to.have.members(registered);
    for (const index of ANSWERERS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await dbClient(index + 1).tempMessageHashes()).to.deep.equal(held);
    }
  });
});
