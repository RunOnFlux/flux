// weight: medium
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Policy arriving from a PEER rather than from the published source.
//
// This is the half of the design that makes github a seed instead of a dependency. A node
// that needs policy asks its direct peers before it asks the source, and what comes back is
// a signed bundle it verifies for itself - so a node can be brought fully up to date while
// the published source is refusing every request. Nothing about that can be shown on one
// node, and nothing about it needs more than three.
//
// Three is the smallest ring whose two arcs are disjoint (peer-topology's 2k+1 with k=1),
// so each node ends with one peer out and one in. bootAndPeer derives that from the fleet;
// no threshold is pinned here.
//
// Both halves of the design are driven here.
//
// The ASK - a node that needs policy asks its peers - is driven by taking the source away
// and giving a node a reason to look.
//
// The ANNOUNCE - a node that adopts tells its peers, and they ask for it - needs a node to
// adopt something new WHILE it has peers. A restart cannot produce that: a node adopts
// during boot, before discovery has given it anyone to tell. A stub peer can, because it
// speaks the protocol and the harness decides who it is connected to. It hands the bundle
// to one real node exactly as a real peer would, and the other two can then only have
// learned from that node.
//
// THE TOPOLOGY IS A CHAIN, and deliberately so. Five indices with a stub peer at the
// last one leaves four dialers at arc 1, and a stub supplies no connection in either
// direction - so the ring does not close and what remains is 0-1-2-3. That is what makes
// a transitive test possible at all: in a closed ring at arc 2 every node is adjacent to
// every other, and "it spread" and "everyone heard it directly" are the same observation.
//
// The stub is wired to node 1 alone, so a bundle has one way in, and node 3 is TWO HOPS
// from it - reachable only if node 2 adopts and then announces onward, which is the
// design's actual claim. Node 0 is a dialer and nothing is asserted of it: with the stub
// at the last index its backward arc wraps onto an empty slot, so it never reaches the
// inbound floor (E2E_FLEET_SIZING.md). bootAndPeer expects exactly this - expectedPeerTotal
// subtracts the stub from the reachable arc and asks for one peer per node.

const stub = (env, path, body) => fetch(`${env.stubControl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

const stubState = (env) => fetch(`${env.stubControl}/state`).then((r) => r.json());

// dbClient is 1-based over node indices: node index 0 is node 1.
const heldSeq = async (index) => (await dbClient(index + 1).policyBundle())?.seq ?? null;

// The stub peer's ring index. Wired to node 1 and to nothing else, so a bundle it hands
// over has exactly one way into the fleet.
const STUB_PEER_INDEX = 4;
const TOLD_NODE = 1;
// One hop from the node that was told, and two. Node 3 has exactly one peer - node 2 -
// so the only way it can hear anything is for node 2 to have adopted and passed it on.
//
// Measured rather than taken on faith: on the first run node 2 was told and adopted 49ms
// after node 1, while node 0 - whose backward arc wraps onto the stub's empty slot - was
// still issuing addoutgoingpeer calls five seconds later and never heard anything.
const ONE_HOP = 2;
const TWO_HOPS = 3;

/**
 * Bring a restarted node back into the mesh.
 *
 * discoveryAutostart is false for every harness fleet, so FluxOS does not dial on its own -
 * bootAndPeer tells each node to start discovering, once. A restarted node comes back with
 * no peers and is never told again, so without this it sits alone for the rest of the run
 * and every peer assertion after it is measuring an isolated node.
 */
async function restartAndRepeer(env, index) {
  await env.restartNode(index);
  await waitForBootSettled(env.clients[index]);
  await env.startDiscovery([index]);
  await waitFor(
    async () => {
      const [out, inc] = await Promise.all([
        env.clients[index].getPeers(),
        env.clients[index].getIncomingPeers(),
      ]);
      return (out.data?.length ?? 0) + (inc.data?.length ?? 0) >= 2;
    },
    { timeout: 120000, interval: 2000, label: `node ${index} back in the mesh` },
  );
}

describe('policy reaching a node from its peers', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 5,
      stubPeers: [STUB_PEER_INDEX],
      // Connected to node 1 only. createTestEnv waits for the link before returning, so a
      // test never has to establish it - and a bundle this stub hands over can only have
      // entered the fleet at node 1.
      stubPeeredWith: { [STUB_PEER_INDEX]: [TOLD_NODE] },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await stub(env, '/policy', { available: true }).catch(() => {});
    await env?.teardown();
  });

  it('every node boots holding the published bundle', async function () {
    this.timeout(120000);
    const { policySeq } = await stubState(env);
    await waitFor(
      async () => (await Promise.all([0, 1, 2, 3].map(heldSeq))).every((s) => s === policySeq),
      { timeout: 90000, label: `all four nodes to hold seq ${policySeq}` },
    );
  });

  it('a node TOLD by a peer adopts it and passes it on to its own peers', async function () {
    this.timeout(300000);
    // The announce half, end to end. Everything below happens with the published source
    // refusing, so no node can have fetched any of it: the only copy in the fleet arrives
    // on one socket, and has to reach the other two by being announced.
    const before = await heldSeq(TOLD_NODE);
    const { seq } = await stub(env, '/blocked-repos', ['told/by-a-peer:v1']);
    expect(seq).to.be.greaterThan(before);
    // The bytes the stub would have served, taken by the SUITE rather than by a node.
    const bundle = await fetch(`${env.stubBaseUrl}/policy-signed.json`).then((r) => r.text());
    await stub(env, '/policy', { available: false });
    const okBefore = (await stubState(env)).policyFetches.ok;

    // Framed and signed as any peer's broadcast, so the receiving node validates and acts
    // on it through the path it uses for a real peer - offerBundle, which verifies against
    // the pinned keys before adopting. A stub peer cannot forge that; it does not have to.
    await env.stubPeerClients.get(STUB_PEER_INDEX).broadcast({
      type: 'fluxpolicy', version: 1, bundle,
    });

    await waitFor(async () => (await heldSeq(TOLD_NODE)) === seq, {
      timeout: 120000,
      label: `node ${TOLD_NODE} to adopt seq ${seq} from the peer that told it`,
    });

    // One hop. Node 2 is connected to node 1 and not to the stub, was not restarted, and
    // cannot reach the source: the only path is node 1 announcing what it just adopted,
    // node 2 asking, and node 1 answering with the signed bundle.
    await waitFor(async () => (await heldSeq(ONE_HOP)) === seq, {
      timeout: 120000,
      label: `node ${ONE_HOP} to be told by node ${TOLD_NODE} and catch up`,
    });

    // TWO hops, which is the claim the design actually makes: each adopter announces to
    // its OWN peers, so a change keeps moving outwards rather than reaching only the
    // neighbours of whoever fetched it. Node 3's single peer is node 2 - it has no
    // connection to node 1, none to the stub, and no route to the source - so it can only
    // have this because node 2 adopted and then passed it on in turn.
    await waitFor(async () => (await heldSeq(TWO_HOPS)) === seq, {
      timeout: 120000,
      label: `node ${TWO_HOPS} to hear it second-hand, two hops from the source`,
    });

    const served = await stubState(env);
    expect(served.policyFetches.ok, 'the source served nothing: this spread peer to peer')
      .to.equal(okBefore);
    expect(served.policyAvailable).to.equal(false);
    await stub(env, '/policy', { available: true });
  });

  it('a node with no stored bundle and no reachable source gets one from its peers', async function () {
    this.timeout(300000);
    const level = await heldSeq(TOLD_NODE);
    expect(level, 'the fleet is level before the source goes away').to.equal(await heldSeq(2));

    // Nothing on disk, nothing to fetch: the only policy left in the world is on the other
    // two nodes. This is the boot the whole ladder exists for.
    await stub(env, '/policy', { available: false });
    await dbClient(3).deletePolicyBundle();
    expect(await heldSeq(2), 'node 2 starts this test with nothing').to.be.null;

    const okBefore = (await stubState(env)).policyFetches.ok;
    await restartAndRepeer(env, 2);

    await waitFor(async () => (await heldSeq(2)) === level, {
      timeout: 150000,
      label: `node 2 to obtain seq ${level} from its peers with the source down`,
    });

    // No successful fetch happened while it caught up, so the bundle it now holds and
    // verified came off a peer's socket. This is the assertion the suite exists for, and
    // it is on the stub rather than in the node's log because the stub is the side that
    // cannot be fooled about whether it served anything.
    const served = await stubState(env);
    expect(served.policyFetches.ok, 'the source served nothing while node 2 caught up')
      .to.equal(okBefore);
    expect(served.policyAvailable, 'the source was refusing throughout').to.equal(false);

    await stub(env, '/policy', { available: true });
  });

  it('a node behind its peers catches up from them when it regains one', async function () {
    this.timeout(300000);
    // The other trigger. Test 2 is a node being TOLD; this is a node ASKING - the rung
    // that runs when a peer appears, rather than when an announcement lands.
    //
    // Exactly one node reaches the source: node 1 is restarted while it is answering, and
    // a restarted node has no peers during its boot refresh, so it fetches. Node 2 is not
    // restarted and its own backstop tick is a day away, so the only thing that can move
    // it is node 1 coming back.
    const { seq } = await stub(env, '/blocked-repos', ['spread/by-peers:v1']);
    await restartAndRepeer(env, TOLD_NODE);
    await waitFor(async () => (await heldSeq(TOLD_NODE)) === seq, {
      timeout: 150000,
      label: `node ${TOLD_NODE} to adopt seq ${seq} from the source`,
    });

    // Everything from here must happen without the source being asked again. The mark is
    // taken after the one node that was meant to fetch has finished fetching.
    const okAfterFetch = (await stubState(env)).policyFetches.ok;
    await waitFor(async () => (await heldSeq(2)) === seq, {
      timeout: 150000,
      label: `node 2 to catch up to seq ${seq} from the peer that has it`,
    });
    expect((await stubState(env)).policyFetches.ok, 'the source served nothing after that one fetch')
      .to.equal(okAfterFetch);

    // And what it caught up to is the document, not just the number.
    const stored = await dbClient(3).policyBundle();
    const payload = JSON.parse(
      Buffer.from(JSON.parse(stored.raw).payload_b64, 'base64').toString('utf8'),
    );
    expect(payload.documents.blockedrepositories).to.deep.equal(['spread/by-peers:v1']);
  });
});

describe('a fleet that has never obtained policy', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    // The source refuses from before the first node starts, so no node has ever held a
    // bundle and none can be told about one by a peer. Configured through createTestEnv
    // rather than afterwards because a node resolves policy once at boot: setting it later
    // would be racing that, and losing the race leaves a fleet that DID get policy - which
    // still looks like a valid fleet, so the suite would go green having tested nothing.
    env = await createTestEnv({ hookCtx: this, nodes: 3, policy: { available: false } });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds no policy at all, and says so', async function () {
    this.timeout(60000);
    for (const index of [0, 1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await heldSeq(index), `node ${index} holds nothing`).to.be.null;
      // eslint-disable-next-line no-await-in-loop
      const owners = await env.clients[index].get('/flux/enterpriseappowners');
      // Not an empty list. "Nobody is an enterprise owner" is a fact about the network;
      // this node is not entitled to state it.
      expect(owners.status, `node ${index} says it cannot tell`).to.equal('error');
    }
  });

  it('holds acquisition shut rather than guessing', async function () {
    this.timeout(300000);
    // The spawner does not defer, back off, or install cautiously: it refuses to consider
    // an app at all. A node that cannot read the policy cannot tell "I am not an
    // enterprise node" from "I do not know yet", and those demand opposite behaviour -
    // guessing the first is what filled enterprise nodes with apps that the ownership
    // sweep then removed from under their owners five minutes after every boot.
    // waitForEvent resolves with the envelope, not the payload: the reason is under .data.
    const blocked = await env.clients[1].waitForEvent(
      'spawner:blocked',
      (payload) => payload.reason === 'policy_not_ready',
      240000,
    );
    expect(blocked.data.reason).to.equal('policy_not_ready');
  });

  it('the whole fleet recovers from one node reaching the source', async function () {
    this.timeout(300000);
    await stub(env, '/policy', { available: true });
    // Only node 0 is restarted, and it is the only node that goes to the source: it boots
    // with no peers, so its boot refresh has nobody to ask and fetches.
    //
    // Nodes 1 and 2 are NOT restarted and their own backstop tick is a day away. What
    // reaches them is the peer rung: node 0 reconnecting is a peerConnected on their side
    // too, and a node holding nothing asks whenever a peer appears. Before that existed
    // this test could only have passed by restarting all three.
    await restartAndRepeer(env, 0);
    await waitFor(async () => (await heldSeq(0)) !== null, {
      timeout: 150000,
      label: 'node 0 to obtain policy once the source answers',
    });

    await waitFor(
      async () => (await Promise.all([1, 2].map(heldSeq))).every((s) => s !== null),
      { timeout: 150000, label: 'nodes 1 and 2 to obtain policy from the peer that has it' },
    );

    // The fetch count is deliberately not asserted here. With the source answering, a node
    // whose peers have nothing newer falls through to it by design, so the number is a
    // property of who asked first rather than of the ladder. The two tests above make that
    // distinction with the source refusing, which is the only way to make it unambiguous.
    const seqs = await Promise.all([0, 1, 2].map(heldSeq));
    expect(new Set(seqs).size, 'the fleet converged on one sequence').to.equal(1);
  });
});
