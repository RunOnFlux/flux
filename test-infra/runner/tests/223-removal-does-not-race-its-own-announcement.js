import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import {
  holdRpc, releaseRpc, getJournal, clearJournal,
} from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const subnet = getSubnetConfig();
const NODES = 4;

// A node does not tell the network it has given an app up until anything it has
// already said about holding that app has gone out.
//
// The two messages contradict each other. An announcement names the apps this node
// holds; a removal says it holds one of them no longer. A cycle that took its list
// before the removal marked the app still names it, and a peer applies whichever
// arrives last - so a claim landing after the removal re-creates the location row
// the removal just cleared, and it stands for the row's full lifetime with nothing
// left to correct it.
//
// The order is forced at the sender: a removal that tells the network waits for the
// cycle in flight to finish sending. The claim is applied first and the removal
// clears it, and a cycle starting from there on reads the mark and leaves the app
// out entirely.
//
// The overlap is made to happen rather than waited for: getbenchmarks is held on
// the holder, which stops a cycle inside the lock, and the removal is issued while
// it is stopped.
describe('a removal does not overtake the announcement that claimed the app', function () {
  let env;
  const appName = `e2eorder${Date.now()}`;
  let holderIdx;
  let peerIdx;
  let holderIp;
  let auth;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: holderIdx } = await seedSimpleApp(env, appName));
    peerIdx = (holderIdx + 1) % env.clients.length;
    holderIp = subnet.nodeIp(holderIdx + 1);
    await waitForUp(env.clients[holderIdx], appName, 'the app is running before the removal');
    auth = await authenticate(env.clients[holderIdx].url, fluxTeamKey());

    // The peer must hold the claim before the removal, or the row being absent at
    // the end says nothing about the order the two messages were applied in.
    const peerDb = dbClient(peerIdx + 1);
    await waitFor(
      async () => (await peerDb.getAppLocations(appName)).some((row) => row.ip.startsWith(holderIp)),
      { timeout: 120000, interval: 2000, label: `peer holds ${holderIp}'s claim for ${appName}` },
    );
  });

  after(async function () {
    this.timeout(60000);
    await releaseRpc(holderIp).catch(() => {});
    await env?.teardown();
  });

  it('leaves no claim behind when the removal is issued inside a cycle', async function () {
    this.timeout(420000);
    const holder = env.clients[holderIdx];
    const peer = env.clients[peerIdx];
    const peerFrom = peer.getLastEventId();
    const holderFrom = holder.getLastEventId();

    // Every getbenchmarks from this node blocks from here. The next cycle takes the
    // announcement lock and stops inside it.
    await clearJournal();
    await holdRpc(holderIp, 'getbenchmarks');

    const announcing = await holder.waitForEvent(
      'app:announcing',
      () => true,
      180000,
      { afterId: holderFrom },
    );
    expect(announcing, 'no cycle started, so nothing here was ever overlapped').to.exist;

    // The event says a cycle took the lock, which it does before deciding whether it
    // can send at all - so it is not yet evidence that one is stopped inside. The
    // journal records a call as it arrives and before the hold blocks it, so a
    // getbenchmarks from this node is that evidence.
    await waitFor(
      async () => {
        const journal = await getJournal({ method: 'getbenchmarks', sourceIp: holderIp });
        return journal.entries.length > 0;
      },
      { timeout: 120000, interval: 500, label: `a cycle on ${holderIp} reaches the held getbenchmarks` },
    );

    // What the hold caught, read before the removal is issued so it counts the
    // cycle's call alone. Holding a method freezes every caller of it on this node,
    // and a node whose other work is stalled behaves differently for reasons the
    // subject below would not name.
    const caught = await getJournal({ method: 'getbenchmarks', sourceIp: holderIp });
    expect(
      caught.entries.length,
      `the hold caught ${caught.entries.length} calls on ${holderIp}, not the cycle's alone`,
    ).to.equal(1);

    // Issued while that cycle is stopped: the removal reaches the point where it
    // would announce itself and waits there.
    // No third path segment: that one is `global`, and it would remove the app from
    // every node on the network rather than this one.
    const removal = fetch(`${holder.url}/apps/appremove/${appName}`, {
      headers: { zelidauth: auth.zelidauth },
    }).catch(() => {});

    await releaseRpc(holderIp);

    const removed = await peer.waitForEvent(
      'network:appremoved',
      (data) => data.name === appName && data.ip.startsWith(holderIp),
      240000,
      { afterId: peerFrom },
    );
    expect(removed, 'the removal never reached the peer, so the row below proves nothing').to.exist;
    await removal;

    // THE SUBJECT. Both messages have been applied. A removal that went out ahead of
    // the announcement that claimed the app leaves the claim standing here.
    const peerDb = dbClient(peerIdx + 1);
    await waitFor(
      async () => !(await peerDb.getAppLocations(appName)).some((row) => row.ip.startsWith(holderIp)),
      { timeout: 60000, interval: 2000, label: `peer drops ${holderIp}'s row for ${appName}` },
    );

    // And it stays dropped: a claim built before the removal and sent after it
    // re-creates the row, which a single read taken too early would miss.
    const settle = Date.now() + 45000;
    while (Date.now() < settle) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await peerDb.getAppLocations(appName);
      expect(
        rows.some((row) => row.ip.startsWith(holderIp)),
        'an announcement built before the removal put the claim back afterwards',
      ).to.be.false;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 3000); });
    }
  });
});
