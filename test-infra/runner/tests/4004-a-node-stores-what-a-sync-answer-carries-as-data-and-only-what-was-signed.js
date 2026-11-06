/*
 * What a state event carries reaches a node's database as data, whatever it reads
 * as, and an event is taken only as what its sender signed. JOINER boots cold with
 * one answering stub peer, so the stub is the peer it asks, and answers with:
 *
 * - a signed appremoved with fields of its own, in an envelope carrying a field
 *   nobody signed. It is the canary: it is stored, as signed.
 * - the stub's signed apprunning, relabelled as a sigterm. A node taking it would
 *   cut the stub's location rows short.
 * - an eviction whose address is not text.
 *
 * The answer is applied in order, so the canary stored last shows the others read.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { appRemovedEvent, apprunningEvent, socketAddr } from '../framework/state-events.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const ANSWERING = 0;
const JOINER = 1;
const EXPRESSIONS = {
  sum: { $add: [1, 2] },
  field: '$ip',
  code: { $function: { body: 'function(){return 42}', args: [], lang: 'js' } },
};

describe('a node stores what a sync answer carries as data, and only what was signed', function () {
  let env;
  let db;
  let signed;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      deferredNodes: 1,
      stubPeers: [ANSWERING],
      answeringSyncPeers: [ANSWERING],
    });
    const broadcastedAt = Date.now();
    const relabelled = await apprunningEvent({ nodeNum: ANSWERING + 1, apps: ['e2esyncapp'], broadcastedAt });
    signed = await appRemovedEvent({
      nodeNum: ANSWERING + 1, appName: 'e2esyncapp', broadcastedAt, extra: EXPRESSIONS,
    });
    await env.stubPeerClients.get(ANSWERING).answerSyncWith({
      fluxapprunningsync: [
        { ...relabelled, type: 'sigterm', dedupKey: 'sigterm' },
        { type: 'evicted', ip: [socketAddr(ANSWERING + 1)], createdAt: new Date(broadcastedAt).toISOString() },
        { ...signed, envelope: { ...signed.envelope, padding: 'added by the peer' } },
      ],
    });

    const joiner = await env.startNode(JOINER);
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    db = dbClient(JOINER + 1);
    await waitFor(
      async () => (await db.appStateEvents({ type: 'appremoved' })).length > 0,
      { timeout: 240000, interval: 2000, label: 'JOINER stored the event its answer carries' },
    );
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('stores what was signed as it was signed', async function () {
    const [row] = await db.appStateEvents({ type: 'appremoved' });
    expect(row.data).to.deep.equal(signed.data);
    expect(row.data.sum, 'the fixture carries an expression').to.deep.equal(EXPRESSIONS.sum);
  });

  it('stores nothing of the envelope that was not signed', async function () {
    const [row] = await db.appStateEvents({ type: 'appremoved' });
    expect(row.envelope).to.deep.equal(signed.envelope);
  });

  it('takes no event as anything but what was signed', async function () {
    expect(await db.appStateEvents({ type: 'sigterm' })).to.deep.equal([]);
  });

  it('takes no eviction of an address that is not text', async function () {
    expect(await db.appStateEvents({ type: 'evicted' })).to.deep.equal([]);
  });
});
