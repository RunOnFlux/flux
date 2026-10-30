/*
 * One client is held to one allowance of unpaid app messages, whichever nodes it
 * registers through.
 *
 * The runner registers through three nodes' own doors, naming its client with
 * x-forwarded-for: each node trusts the fleet gateway as a balancer, so the
 * caller it tags is the one the header names. The allowance is 2. Client A's two
 * registrations go through two different nodes; its third goes through a third
 * node, which has never served A, and is refused there because the first two
 * reached it. Client B, through the same node in the same epoch, is taken: the
 * refusal is A's, not the node's. An IPv6 client is one /64.
 *
 * The ticker is stopped and the chain is moved to the start of a tag epoch first.
 * A tag changes at each epoch boundary, so a boundary crossed mid-test would hand
 * A a fresh allowance and pass the refusals for the wrong reason.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { stopTicker, queueAppTx, advanceBlock } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  startTagEpoch, currentTagHeight, pendingMessageOn,
} from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
// Never index 0: every backward arc wraps onto it.
const ENTRIES = [1, 2, 3];
const CLIENT_TAG_CAP = 2;

// RFC 5737 / RFC 3849 documentation ranges.
const CLIENT_A = '198.51.100.71';
const CLIENT_B = '198.51.100.72';
const V6_FIRST = '2001:db8:71:1::1';
const V6_SAME_64 = '2001:db8:71:1::99';
const V6_OTHER_64 = '2001:db8:71:2::1';

describe('one client is held to its allowance of unpaid app messages, whichever nodes it registers through', function () {
  let env;
  let tagHeight;
  const owner = appOwnerKey();
  const stamp = Date.now();
  const heldByA = [];

  dumpLogsOnFailure(() => env);

  const register = (entry, client, label) => registerApp(
    env.clients[entry].url,
    nodeKey(entry + 1),
    buildAppSpec({ name: `e2eallow${label}${stamp}`, ownerKey: owner }),
    'fluxappregister',
    { ownerKey: owner, headers: { 'x-forwarded-for': client } },
  );

  const taken = (result) => {
    expect(result.status, JSON.stringify(result)).to.equal('success');
    return result.data;
  };

  const heldEverywhere = (hash) => waitFor(async () => {
    const held = await Promise.all(env.clients.map((c) => pendingMessageOn(c, hash)));
    return held.every((doc) => doc !== null);
  }, { timeout: 60000, interval: 2000, label: `${hash} held by every node` });

  const tagsOf = (hash) => Promise.all(env.clients.map((c) => pendingMessageOn(c, hash).then((doc) => doc?.clientTag ?? null)));

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      configOverrides: {
        fdmAddresses: [getSubnetConfig().gateway],
        fluxapps: { clientTagCap: CLIENT_TAG_CAP },
      },
    });
    await bootAndPeer(env);
    await stopTicker();
    tagHeight = await startTagEpoch(env.clients);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('tags a client the same on every node, whichever node it registered through', async function () {
    this.timeout(180000);
    heldByA.push(taken(await register(ENTRIES[0], CLIENT_A, 'a1')));
    heldByA.push(taken(await register(ENTRIES[1], CLIENT_A, 'a2')));
    await heldEverywhere(heldByA[0]);
    await heldEverywhere(heldByA[1]);

    const first = await tagsOf(heldByA[0]);
    const second = await tagsOf(heldByA[1]);
    expect(first.every((tag) => /^[0-9a-f]{64}$/.test(tag)), `tags: ${first}`).to.equal(true);
    expect(new Set([...first, ...second]).size, 'one client carried more than one tag').to.equal(1);
  });

  it('refuses the client\'s next registration at a node it has never used', async function () {
    this.timeout(120000);
    const refused = await register(ENTRIES[2], CLIENT_A, 'a3');

    expect(refused.status, JSON.stringify(refused)).to.equal('error');
    expect(refused.data.message).to.include(`its client already has ${CLIENT_TAG_CAP} unpaid app messages pending`);
  });

  it('takes another client through the same node, under another tag', async function () {
    this.timeout(120000);
    const hash = taken(await register(ENTRIES[2], CLIENT_B, 'b1'));
    await heldEverywhere(hash);

    const [tagA] = await tagsOf(heldByA[0]);
    const tagsB = await tagsOf(hash);
    expect(tagsB.every((tag) => tag !== null && tag !== tagA), `B's tags: ${tagsB}`).to.equal(true);
  });

  it('holds every address in one IPv6 /64 to one allowance, and not another /64', async function () {
    this.timeout(240000);
    const first = taken(await register(ENTRIES[0], V6_FIRST, 'v61'));
    const second = taken(await register(ENTRIES[1], V6_FIRST, 'v62'));
    await heldEverywhere(first);
    await heldEverywhere(second);

    const sameBlock = await register(ENTRIES[2], V6_SAME_64, 'v63');
    expect(sameBlock.status, JSON.stringify(sameBlock)).to.equal('error');
    expect(sameBlock.data.message).to.include('its client already has');

    taken(await register(ENTRIES[2], V6_OTHER_64, 'v64'));
  });

  it('gives the client its allowance back for a message once it is paid', async function () {
    this.timeout(240000);
    await queueAppTx(heldByA[0]);
    await advanceBlock();
    await waitFor(async () => {
      const response = await env.clients[ENTRIES[2]].get(`/apps/permanentmessages/${heldByA[0]}?_=${Date.now()}`);
      return response.status === 'success' && response.data?.length > 0;
    }, { timeout: 120000, interval: 2000, label: 'A\'s first registration paid and promoted on the node A registers through next' });
    expect(await currentTagHeight(), 'the chain left the tag epoch, so A\'s tag changed').to.equal(tagHeight);

    taken(await register(ENTRIES[2], CLIENT_A, 'a4'));
  });
});
