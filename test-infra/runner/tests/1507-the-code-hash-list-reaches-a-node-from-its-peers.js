/*
 * The signed FluxOS code hash list reaches a node from its peers, and the node serves what it
 * holds to fluxbench on /flux/hashlist.
 *
 * The source refuses one node by its address and answers the others. The others take the list
 * from it once their peers have nothing to give, and each announces what it adopted; the refused
 * node can then have the list only by asking a peer that announced, and it verifies what that
 * peer sends for itself, so a peer is as good as the publisher. The list travels on the same
 * exchange as the network policy (1502 proves that exchange's ladder and thresholds for policy);
 * this suite proves the hash list's own messages, capability, keys, row and route.
 *
 * Three nodes: the smallest ring whose two arcs are disjoint, each node ending with a peer out
 * and a peer in. The refused node is node 1, the middle of the ring; nothing is asserted of node
 * 0, whose backward arc wraps. A node fetches from the source only once it is peered, so the
 * refusal is in place before any node can ask. The backstop tick is put a week out, so the only
 * fetches are the ones the ladder makes.
 *
 * fluxbench is not in the harness: what it reads is the route, and the route's bytes are checked
 * against the publisher's.
 */
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';
import { hashListSourceUrl, setHashList, hashListSource } from '../framework/external-http-control.js';
import policySigning from '../../external-http-stub/policy-signing.js';

// The node the source refuses, and the one it answers.
const REFUSED = 1;
const ANSWERED = 2;

// dbClient and nodeIp are 1-based over node indices: node index 0 is node 1.
const heldSeq = async (index) => (await dbClient(index + 1).hashList())?.seq ?? null;
const addressOf = (index) => getSubnetConfig().nodeIp(index + 1);

describe('the code hash list reaches a node from its peers', function () {
  let env;
  let seq;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: {
        hashList: {
          sourceUrl: hashListSourceUrl(),
          publicKeys: [policySigning.HASH_LIST_PUBLIC_HEX],
          refreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
          minConfirmingPeers: 1,
        },
      },
    });
    ({ seq } = await setHashList({ available: true, refuse: [addressOf(REFUSED)] }));
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    await setHashList({ available: true, refuse: [] }).catch(() => {});
    await env?.teardown();
  });

  it('a node the source answers takes the list from the source', async function () {
    this.timeout(240000);
    await waitFor(async () => (await heldSeq(ANSWERED)) === seq, {
      timeout: 180000, interval: 2000, label: `node ${ANSWERED} to store hash list seq ${seq}`,
    });
    const { fetches } = await hashListSource();
    expect(fetches.byClient[addressOf(ANSWERED)]?.ok, 'the source served it').to.be.greaterThan(0);
  });

  it('a node the source refuses takes the list from a peer', async function () {
    this.timeout(240000);
    const adopted = await env.clients[REFUSED].waitForEvent(
      'hashList:documentChanged',
      (data) => data?.seq === seq,
      180000,
      // One list was published, and this node adopts it once: the only such event is this one.
      { afterId: 0 },
    );
    expect(adopted.data.source, 'adopted from a peer, the only rung open to it').to.equal('peer');
    await waitFor(async () => (await heldSeq(REFUSED)) === seq, {
      timeout: 60000, interval: 1000, label: `node ${REFUSED} to store hash list seq ${seq}`,
    });
    const { fetches } = await hashListSource();
    expect(fetches.byClient[addressOf(REFUSED)]?.ok ?? 0, 'the source served it nothing').to.equal(0);
  });

  it('the refused node serves on /flux/hashlist the list the publisher signed', async function () {
    this.timeout(60000);
    const { document } = await hashListSource();
    const served = await env.clients[REFUSED].request('GET', '/flux/hashlist');
    expect(served.status).to.equal(200);
    expect(served.data, 'the envelope as signed, both fields as the publisher wrote them')
      .to.deep.equal(JSON.parse(document));
  });
});
