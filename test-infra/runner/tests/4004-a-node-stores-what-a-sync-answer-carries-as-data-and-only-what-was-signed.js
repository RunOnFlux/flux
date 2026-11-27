/*
 * An event is taken only as what its sender signed, and only in the form its type
 * describes. JOINER boots cold with one answering stub peer, so the stub is the
 * peer it asks, and answers with:
 *
 * - the stub's signed apprunning, relabelled as a sigterm. A node taking it would
 *   cut the stub's location rows short.
 * - an eviction whose address is not text.
 * - a signed appremoved carrying fields of its own that read as expressions. A
 *   removal is exactly its version's fields, so it is refused whole.
 * - a well-formed signed appremoved, in an envelope carrying a field nobody
 *   signed. It is the canary: it is stored, as signed.
 *
 * The answer is applied in order, so the canary stored last shows the others read.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { appRemovedEvent, apprunningEvent, socketAddr } from '../framework/state-events.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

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
    const withFieldsOfItsOwn = await appRemovedEvent({
      nodeNum: ANSWERING + 1, appName: 'e2esyncexpressions', broadcastedAt, extra: EXPRESSIONS,
    });
    signed = await appRemovedEvent({ nodeNum: ANSWERING + 1, appName: 'e2esyncapp', broadcastedAt });
    await env.stubPeerClients.get(ANSWERING).answerSyncWith({
      fluxapprunningsync: [
        { ...relabelled, type: 'sigterm', dedupKey: 'sigterm' },
        { type: 'evicted', ip: [socketAddr(ANSWERING + 1)], createdAt: new Date(broadcastedAt).toISOString() },
        withFieldsOfItsOwn,
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

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('stores what was signed as it was signed', async function () {
    const rows = await db.appStateEvents({ type: 'appremoved' });
    expect(rows.map((row) => row.data)).to.deep.equal([signed.data]);
  });

  it('stores no removal carrying fields of its own', async function () {
    const rows = await db.appStateEvents({ type: 'appremoved' });
    expect(rows.map((row) => row.data.appName), 'a removal with fields no removal carries was stored').to.not.include('e2esyncexpressions');
  });

  it('stores nothing of the envelope that was not signed', async function () {
    const [row] = await db.appStateEvents({ type: 'appremoved', 'data.appName': 'e2esyncapp' });
    expect(row.envelope).to.deep.equal(signed.envelope);
  });

  it('takes no event as anything but what was signed', async function () {
    expect(await db.appStateEvents({ type: 'sigterm' })).to.deep.equal([]);
  });

  it('takes no eviction of an address that is not text', async function () {
    expect(await db.appStateEvents({ type: 'evicted' })).to.deep.equal([]);
  });
});
