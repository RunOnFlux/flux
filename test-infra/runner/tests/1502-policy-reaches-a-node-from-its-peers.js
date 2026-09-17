// weight: medium
import {
  describe, it, before, after, afterEach,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { bootAndPeer, waitForLocationTable } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
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

  // Several tests here take the source down and restore it on their last line. Restoring it
  // per TEST instead means a failure cannot leave it down for everything after it: when one
  // did, the next two failed on a dead source and reported three defects where there was one.
  afterEach(async () => {
    await stub(env, '/policy', { available: true }).catch(() => {});
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

  it('answers two nodes asking the same question, not just the first', async function () {
    this.timeout(300000);
    // THE PROPERTY A SINGLE ASKER CANNOT SHOW. Messages are deduplicated on the payload
    // alone, and a request payload carries no sender - `{fluxpolicyrequest, seq}` is what
    // every node at that sequence sends. So two nodes asking the same peer the same
    // question are byte-identical, and a filter that treats the second as a repeat of the
    // first drops it with no answer, no NAK and no log.
    //
    // One asker converging proves nothing here: the first asker is always answered. The
    // assertion is that the SECOND one is too, so both ONE_HOP and TWO_HOPS have to arrive.
    //
    // The source is held down throughout, so neither of them can have fetched it - the only
    // way either holds the new bundle is that its own request was answered.
    const { seq } = await stub(env, '/blocked-repos', ['two/askers:v1']);
    const bundle = await fetch(`${env.stubBaseUrl}/policy-signed.json`).then((r) => r.text());
    await stub(env, '/policy', { available: false });
    const okBefore = (await stubState(env)).policyFetches.ok;

    await env.stubPeerClients.get(STUB_PEER_INDEX).broadcast({
      type: 'fluxpolicy', version: 1, bundle,
    });
    await waitFor(async () => (await heldSeq(TOLD_NODE)) === seq, {
      timeout: 120000,
      label: `node ${TOLD_NODE} to adopt seq ${seq} from the stub peer`,
    });

    await waitFor(
      async () => {
        const held = await Promise.all([ONE_HOP, TWO_HOPS].map(heldSeq));
        return held.every((h) => h === seq);
      },
      {
        timeout: 150000,
        label: `both node ${ONE_HOP} and node ${TWO_HOPS} to be answered, not just whichever asked first`,
      },
    );

    expect((await stubState(env)).policyFetches.ok, 'neither of them fetched it')
      .to.equal(okBefore);
  });

  it('asks every peer that arrives without ever reaching the source', async function () {
    this.timeout(300000);
    // A node holding policy asks each peer that joins, with no cap on how many times it
    // will do so. That is affordable only because the targeted rung cannot reach the
    // published source, and this is what holds it unable to: the source is the fleet's
    // shared, rate-limited dependency, and a rung that runs on every reconnect must never
    // touch it.
    //
    // Arrivals are made by partitioning and healing rather than by restarting. A restarted
    // node fetches during its boot refresh - test 4 depends on exactly that - so a restart
    // would move the counter for a legitimate reason and the assertion could not tell the
    // two apart. A healed partition produces the same peerConnected arrival with no boot
    // refresh anywhere, so ANY successful fetch here is the ask rung reaching the source.
    //
    // The source is left AVAILABLE on purpose. Asserting that nothing was served while the
    // source refuses everything would assert the fixture rather than the node.
    const okBefore = (await stubState(env)).policyFetches.ok;
    const settled = await heldSeq(ONE_HOP);

    const REST = [0, TOLD_NODE, ONE_HOP];
    for (let i = 0; i < 2; i += 1) {
      await env.partitionGroups([TWO_HOPS], REST);
      await env.healPartition([TWO_HOPS], REST);
      await env.startDiscovery([TWO_HOPS]);
      // Counted rather than named: the node is cut off from the whole fleet, so its peers
      // go to zero and coming back is unambiguous.
      await waitFor(
        async () => {
          const [out, inc] = await Promise.all([
            env.clients[TWO_HOPS].getPeers(),
            env.clients[TWO_HOPS].getIncomingPeers(),
          ]);
          return (out.data?.length ?? 0) + (inc.data?.length ?? 0) >= 2;
        },
        { timeout: 120000, interval: 2000, label: `node ${TWO_HOPS} back in the mesh` },
      );
    }

    expect(await heldSeq(ONE_HOP), 'nothing was published, so nothing moved').to.equal(settled);
    expect((await stubState(env)).policyFetches.ok, 'the source was never asked')
      .to.equal(okBefore);
  });
});

describe('a node that restored STALE policy catches up before it acts', function () {
  // The state is SEEDED, not driven into existence by restarting a running fleet. Node 0
  // boots with an old bundle already in its database; the network has moved on. That is a
  // node coming back after being away, and it is a starting condition, not a sequence of
  // events to perform.
  //
  // What it proves is the reason restore() no longer opens the gate: disk says the bundle
  // is real, never that it is still the network's. Node 0 must not act on seq 4 just
  // because it verified - it has to find out it is behind, and catch up, first.
  const STALE_SEQ = 4;
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      // Well above the seeded bundle, so the node is unambiguously behind.
      policy: { seq: 40 },
      policySeeds: { 0: STALE_SEQ },
      // SOMEBODY HAS TO REACH THE SOURCE, and in a three-node fleet nobody would.
      //
      // Nodes 1 and 2 boot empty, and the first thing that answers them is node 0 holding
      // the seeded seq 4. They adopt it - correctly: a node with no policy takes what a
      // peer offers, which is the whole point of asking peers before the source. But
      // having policy, none of them is a candidate for the seed any more, and the fleet
      // settles on seq 4 with the network at 40.
      //
      // That is the stale-neighbourhood case, and what corrects it in production is the
      // phased tick: 6,370 nodes on a 24-hour period is one node looking every ~13
      // seconds. Three nodes on the same period is one look every eight hours, so the
      // tick is compressed on one of them - the fixture supplying at three nodes what the
      // fleet supplies by its size. Node 0 is left alone; it is the subject.
      nodeConfigOverrides: { 1: { policy: { refreshIntervalMs: 15000 } } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('catches up to the network rather than acting on what it had', async function () {
    this.timeout(240000);
    const published = (await stubState(env)).policySeq;
    expect(published, 'the network is ahead of the seeded bundle').to.be.greaterThan(STALE_SEQ);

    // It ends level with everyone else. Getting there is the ask: it restored seq 4,
    // found a peer holding more, and took the newer bundle - verifying it for itself,
    // because a peer is not trusted, only checked.
    await waitFor(
      async () => (await Promise.all([0, 1, 2].map(heldSeq))).every((n) => n === published),
      { timeout: 150000, label: `all three nodes to reach seq ${published}` },
    );

    // BY WHICH ROUTE, because "everyone reached 40" is true of a fleet that all went to
    // github independently, which is the thing this design exists to stop. The ticking
    // node is the one that reaches the source; node 0 - the subject - is told by a peer.
    const rungsFor = (index, seq) => env.clients[index].getEventBuffer()
      .filter((e) => e.event === 'policy:bundleChanged' && e.data.seq === seq)
      .map((e) => e.data.source);
    expect(rungsFor(1, published), 'node 1 reached the source on its compressed tick')
      .to.include('backstop');
    expect(rungsFor(0, published), 'and node 0 was told by a peer, never by github')
      .to.deep.equal(['peer']);
  });

  it('and only then starts considering apps', async function () {
    this.timeout(180000);
    // The gate is downstream of that. A node acting on the stale bundle would have got
    // here while still at seq 4; this one could not, because restoring does not confirm.
    await waitFor(
      () => env.nodeLogCount(0, 'Checking for apps that are missing instances') > 0,
      { timeout: 150000, interval: 3000, label: 'node 0 to get past the policy gate' },
    );
    expect(await heldSeq(0), 'and it is current when it does').to.equal((await stubState(env)).policySeq);
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
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      policy: { available: false },
      // The source never answers, so this fleet never holds policy - which is the subject.
      // Said here rather than inferred from the option beside it: whether a fixture WANTS a
      // policy-less fleet is intent, and the framework can only derive whether one could
      // peer at all.
      awaitPolicy: false,
    });
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

describe('a node whose source answered with something that did not verify', function () {
  // A source that REFUSES and a source that answers with the wrong bytes are different
  // failures, and only the second one can be mistaken for the publisher. A captive portal,
  // a transparent proxy and an injected ISP page all return 200 with a body; so does a
  // signer the fleet does not pin. None of them is the network speaking.
  //
  // What this covers is what the node does NEXT. Refusing the bundle was never in doubt -
  // suite 1501 proves that on a single node. The question is whether the refusal left the
  // node able to accept a real bundle afterwards, and act on it.
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    // Set through createTestEnv rather than afterwards, for the same reason the block above
    // gives: policy is resolved once at boot, and a fleet that obtained a good bundle first
    // would be testing a node that never met the failure.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      policy: { available: true, signer: 'rogue' },
      // The source answers, and everything it serves is refused - so this fleet holds no
      // policy however long it is given. A source that RESPONDS is not a fleet that ends up
      // with a bundle, and only this fixture knows the difference.
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('refuses it, and holds nothing', async function () {
    this.timeout(120000);
    const held = await Promise.all([0, 1, 2].map(heldSeq));
    expect(held, 'a valid signature from an untrusted signer is not policy').to.deep.equal([null, null, null]);
    // It ANSWERED, which is the half that matters here - the fleet met a body, not silence.
    expect((await stubState(env)).policyFetches.ok, 'the fleet did fetch it').to.be.greaterThan(0);
  });

  it('still opens its gate when a peer later hands it a real bundle', async function () {
    this.timeout(360000);
    // Node 1 is restarted and node 0 is NOT, and that asymmetry is the entire test. A
    // restart builds a fresh process and clears whatever the failed fetch left behind, so
    // a node that is restarted cannot show this defect - only one that met the bad answer
    // and is still running can. Node 1 is therefore the courier, and node 0 is the subject.
    await stub(env, '/policy', { available: true, signer: 'pinned' });
    await restartAndRepeer(env, 1);

    await waitFor(async () => (await heldSeq(1)) !== null, {
      timeout: 150000,
      label: 'node 1 to obtain a real bundle now the source is signing with a pinned key',
    });

    await waitFor(async () => (await heldSeq(0)) !== null, {
      timeout: 150000,
      label: 'node 0 to take the bundle from its peer',
    });

    // Holding it is not the property. Acquisition is downstream of confirmation, and a node
    // that adopted a bundle while unable to confirm holds exactly the right policy and will
    // never install anything again - a failure that is invisible in the database and only
    // shows here.
    await waitFor(
      () => env.nodeLogCount(0, 'Checking for apps that are missing instances') > 0,
      { timeout: 180000, interval: 3000, label: 'node 0 to get past the policy gate' },
    );
  });
});

describe('a fleet where only the source has the new policy', function () {
  // THE STALE-FLEET CASE, and the only one peers cannot resolve between them. Every node
  // holds the same sequence, so every node answers every other "I am not ahead of you" -
  // true, useless, and indistinguishable from the fleet being current. Something has to
  // reach the published source.
  //
  // IN PRODUCTION THAT IS THE PHASED TICK, not a fetch at boot. Each node's slot is
  // sha256(collateral) mod the period, so the ticks are spread uniformly across it: 6,370
  // nodes on a 24-hour period is one node looking every ~13 seconds, and whatever it finds
  // it announces to its peers. No node has to check for itself, and none does - a boot
  // fetch on every node is the release-wave stampede the phasing exists to prevent.
  //
  // A three-node fleet has no "rest of the fleet": the same 24-hour period is one look
  // every eight hours, so nothing corrects it inside a test. SO THE TICK IS COMPRESSED ON
  // ONE NODE, which is what production has and what this fleet otherwise cannot: the other
  // two are left at the full period, so what reaches THEM can only have come from a peer.
  // Suite 1601 draws the same distinction for the same reason.
  //
  // Its own fleet rather than a knob on the one above, because a node polling in the
  // background makes "the source served nothing" false for every test that shares it - and
  // those assertions are how the peer-to-peer path is proved at all.
  const SOURCE_NODE = 0;
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      nodeConfigOverrides: { [SOURCE_NODE]: { policy: { refreshIntervalMs: 15000 } } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('one node reaches the source on its tick, and the rest learn it from that peer', async function () {
    this.timeout(300000);
    const before = await Promise.all([0, 1, 2].map(heldSeq));
    expect(new Set(before).size, 'the fleet starts level').to.equal(1);

    const { seq } = await stub(env, '/blocked-repos', ['spread/by-peers:v1']);
    expect(seq, 'the source now holds something the whole fleet is behind').to.be.greaterThan(before[0]);

    // Node 0's slot comes round every 15s, so it is the one that looks. Nothing else in
    // this fleet can reach the source inside the test window.
    await waitFor(async () => (await heldSeq(SOURCE_NODE)) === seq, {
      timeout: 150000,
      label: `node ${SOURCE_NODE} to adopt seq ${seq} on its tick`,
    });

    // Everything from here must happen without the source being asked again. The mark is
    // taken after the one node that ticks has finished fetching.
    const okAfterFetch = (await stubState(env)).policyFetches.ok;
    await waitFor(
      async () => (await Promise.all([1, 2].map(heldSeq))).every((held) => held === seq),
      { timeout: 150000, label: `nodes 1 and 2 to catch up to seq ${seq} from the peer that has it` },
    );

    // They did NOT go to the source. Their own period is the full 24 hours, so a fetch here
    // would mean something other than the peer rung moved them - which is the whole claim.
    expect((await stubState(env)).policyFetches.ok, 'the two nodes left on the full period fetched nothing')
      .to.equal(okAfterFetch);

    // And what they caught up to is the document, not just the number.
    for (const index of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await dbClient(index + 1).policyBundle();
      const payload = JSON.parse(
        Buffer.from(JSON.parse(stored.raw).payload_b64, 'base64').toString('utf8'),
      );
      expect(payload.documents.blockedrepositories, `node ${index} holds the document`)
        .to.deep.equal(['spread/by-peers:v1']);
    }
  });
});

// THE PEER THRESHOLD IS WHAT LICENSES A FETCH FROM THE SOURCE, and the state that matters is
// "this node has peers and is below it". That state is where the decision used to go wrong:
// the store used to read a count that reported 0 below the threshold as well as at zero
// peers, so a node ramping up its peer set looked identical to a node with nobody to ask -
// and the rung below asking peers is github.
//
// The harness default of 2 makes that state ONE CONNECTION WIDE, which is why no suite caught
// it. Ten nodes give the derived ring an arc of 4, so every node settles on eight peers; a
// threshold of six is then crossed on the way there, and nodes spend real time holding
// nothing with peers they could have asked. Only the threshold is pinned - the arc stays
// derived, as E2E_FLEET_SIZING requires.
describe('the peer threshold is what licenses a fetch from the source', function () {
  let env;
  // Deferred, so it joins a fleet that already holds policy rather than booting beside it.
  // A node that boots WITH the fleet cannot show this: everyone is empty at once, so taking
  // policy from a peer and seeding it from the source are the same observation.
  const LATE_NODE = 9;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 10,
      deferredNodes: 1,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { appSyncPeerThreshold: 6, appSyncDegradedThreshold: 2 },
        // The tick is not this block's subject and would confound it: its slot is derived
        // from node identity and lands anywhere in the period, so on the harness default of
        // a day a node can be seconds from ticking and fetch for a reason that has nothing
        // to do with the decision being measured. A week puts it out of reach of a run.
        policy: { refreshIntervalMs: 7 * 24 * 60 * 60 * 1000 },
      },
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await stub(env, '/policy', { available: true }).catch(() => {});
    await env?.teardown();
  });

  it('a node joining a fleet that holds policy takes it from a peer, with the source available', async function () {
    this.timeout(420000);
    // THE PROPERTY THE WHOLE LADDER IS FOR. The source is up, answering, and counting - so
    // this is not a fixture that makes github impossible, it is a node choosing not to use
    // it. The old code could not have passed: start() ran before discovery, read a peer
    // count of 0 because the set was empty, and fetched.
    const { policySeq } = await stubState(env);
    const running = Array.from({ length: LATE_NODE }, (_unused, i) => i);
    await waitFor(
      async () => (await Promise.all(running.map(heldSeq))).every((s) => s === policySeq),
      { timeout: 180000, label: `the established fleet to hold seq ${policySeq}` },
    );

    const before = (await stubState(env)).policyFetches;
    const client = await env.startNode(LATE_NODE);
    await waitForBootSettled(client);
    await env.startDiscovery([LATE_NODE]);

    await waitFor(async () => (await heldSeq(LATE_NODE)) === policySeq, {
      timeout: 240000,
      interval: 2000,
      label: `node ${LATE_NODE} to obtain seq ${policySeq} from its peers`,
    });

    // On the stub rather than in the node's log, because the stub is the side that cannot
    // be fooled about whether it served anything. TOTAL, not ok: a request that was made
    // and refused is still a request that left the node, which is the thing being denied.
    const after = (await stubState(env)).policyFetches;
    expect(after.total, 'the node never asked the source, though it was there to ask')
      .to.equal(before.total);
  });

  it('and it asked the peers it had rather than waiting to finish peering', async function () {
    this.timeout(60000);
    // The ask is per arrival, so it starts at the FIRST peer - well below the threshold.
    // Without that a node would hold nothing until its set filled, which on a slow join is
    // minutes of a node that could have been current in milliseconds.
    //
    // ON THE EVENT, WHICH NAMES THE RUNG, rather than on a log line that happens to mention
    // one. policy:bundleChanged carries where the bundle came from, so this asserts the
    // fact directly - and asserting the WHOLE list rather than "a peer one exists" is what
    // makes a backstop fetch a failure here instead of something sitting unnoticed beside
    // a peer adoption.
    const rungs = env.clients[LATE_NODE].getEventBuffer()
      .filter((e) => e.event === 'policy:bundleChanged')
      .map((e) => e.data.source);
    expect(rungs, 'every bundle it holds came off a peer, none from the source')
      .to.deep.equal(['peer']);
  });
});

// The other side of the same rule. A fleet that can never finish peering never reaches the
// edge, so it never seeds - and that is correct rather than a gap: a node below the threshold
// is one the network has already decided should not be acquiring apps, and a timer that went
// to the source anyway would be overriding that decision. Three dialers at arc 1 give every
// node two peers against a threshold of six, so the edge cannot fire however long this waits.
describe('a fleet too small to finish peering never asks the source', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { appSyncPeerThreshold: 6, appSyncDegradedThreshold: 2 },
        // Out of reach of this run, for the reason the block above gives: a tick firing
        // inside the window would fetch for a reason that is not the one under test.
        policy: { refreshIntervalMs: 7 * 24 * 60 * 60 * 1000 },
      },
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds nothing, and leaves the source untouched while it does', async function () {
    this.timeout(180000);
    // A NEGATIVE ASSERTION NEEDS THE SUBJECT TO HAVE ARRIVED. The fleet is peered before
    // this runs (bootAndPeer above), and the peers are asserted here, so "nobody fetched"
    // is measured over nodes that are up, connected and have had the chance to - not over
    // a fleet that never started.
    for (const index of [0, 1, 2]) {
      const [out, inc] = await Promise.all([
        env.clients[index].getPeers(),
        env.clients[index].getIncomingPeers(),
      ]);
      const peers = (out.data?.length ?? 0) + (inc.data?.length ?? 0);
      expect(peers, `node ${index} is peered, and still short of the threshold`)
        .to.be.within(1, 5);
    }

    // Long enough that a boot fetch or a peer-arrival fetch would have landed - the peer
    // window is three seconds and every node has been up and peered since bootAndPeer.
    await new Promise((resolve) => { setTimeout(resolve, 20000); });

    const { policyFetches, policyAvailable } = await stubState(env);
    expect(policyAvailable, 'the source was there to be asked throughout').to.equal(true);
    for (const index of [0, 1, 2]) {
      expect(
        env.clients[index].getEventBuffer().filter((e) => e.event === 'policy:bundleChanged'),
        `node ${index} holds nothing, from any rung`,
      ).to.deep.equal([]);
    }
    expect(policyFetches.total, 'and no node asked it, because none of them finished peering')
      .to.equal(0);
    for (const index of [0, 1, 2]) {
      expect(await heldSeq(index), `node ${index} holds nothing`).to.be.null;
    }
  });
});

// THE TABLE FOLLOWS THE BUNDLE, AND IT FOLLOWS IT ON AN EVENT.
//
// The signed bundle names which file is the iplocation table and what it must hash to, so
// ipLocationSync cannot act until one is held. It starts on dbReady - a fact about the app
// database, which says nothing about policy - and when it found nothing it backed off for ten
// minutes. Both chains hang off the peer threshold and nothing orders them, so which finished
// first was a race; and a bundle arriving LATER, naming a new baseline, was not noticed until
// the next daily refresh.
//
// What is asserted here is the order of two facts on one node: the bundle changed, and then
// the table it names was installed - promptly, and without the daily refresh coming round.
describe('the location table follows the bundle that names it', function () {
  // Compressed on one node only, as the block above explains: it is the node that reaches the
  // source and announces what it finds, and the others can only have learned from a peer.
  const TICKING_NODE = 0;
  const PEER_NODE = 1;
  let env;

  dumpLogsOnFailure(() => env);

  const publishTable = (body) => fetch(`${env.stubControl}/iplocation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      // Published before the fleet boots, so every node's first bundle names THIS artifact
      // and the baseline below is the one they all start from. A publication after
      // createTestEnv returns re-signs the bundle, and a node still holding the previous one
      // then asks for a digest the stub no longer serves.
      locationTable: { domains: 2, subnet: getSubnetConfig().base },
      nodeConfigOverrides: { [TICKING_NODE]: { policy: { refreshIntervalMs: 15000 } } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((client) => waitForLocationTable(client, { domains: 2 })));
  });

  after(async function () {
    this.timeout(60000);
    await publishTable({ domains: 1 }).catch(() => {});
    await env?.teardown();
  });

  it('installs a newly published table without waiting for its daily refresh', async function () {
    this.timeout(300000);
    // Every node is on the baseline and its refresh is a day away, so nothing here can be
    // the daily tick coming round. The ONLY thing that changes is the bundle.
    const seenBefore = (index, name) => env.clients[index].getEventBuffer()
      .filter((e) => e.event === name).length;
    const bundlesBefore = seenBefore(PEER_NODE, 'policy:bundleChanged');
    const installsBefore = seenBefore(PEER_NODE, 'ipLocation:tableInstalled');

    // A new baseline: new bytes, new digest, and a re-signed bundle naming it.
    const published = await publishTable({ domains: 3, subnet: getSubnetConfig().base });
    expect(published.ok, 'the stub accepted the new baseline').to.equal(true);

    // The ticking node reaches the source and announces; the peer node adopts from that
    // announcement, which is the arrival this wiring hangs on.
    await waitFor(
      () => seenBefore(PEER_NODE, 'policy:bundleChanged') > bundlesBefore,
      { timeout: 180000, interval: 2000, label: `node ${PEER_NODE} to be told the bundle changed` },
    );

    // THE PROPERTY. Not "eventually" - the daily refresh would also get there, in a day.
    await waitFor(
      () => seenBefore(PEER_NODE, 'ipLocation:tableInstalled') > installsBefore,
      { timeout: 120000, interval: 2000, label: `node ${PEER_NODE} to install the table the new bundle names` },
    );

    // ORDER, not just co-occurrence: the install has to come after the bundle that named it.
    const buffer = env.clients[PEER_NODE].getEventBuffer();
    const bundle = buffer.filter((e) => e.event === 'policy:bundleChanged').pop();
    const install = buffer.filter((e) => e.event === 'ipLocation:tableInstalled').pop();
    expect(install.id, 'the table was installed after the bundle named it').to.be.greaterThan(bundle.id);

    // AND IT IS THE NEW BASELINE BEING SERVED, not the one it booted on. Waited for rather
    // than read straight after the install event: installing the artifact and re-resolving
    // every node's location against it are two steps, and the second is started by the
    // first rather than awaited by it. The event says the table landed; this says placement
    // is answering from it.
    await waitForLocationTable(env.clients[PEER_NODE], { domains: 3 });
  });
});

// Two peers answering the same question with the same thing.
//
// A reply carries no sender and no timestamp of its own, so `{fluxpolicyseq, seq: null}` is
// byte-identical from every peer that holds nothing. A filter keyed on content alone reads
// the second as a repeat of the first and drops it, and the ask it would have settled waits
// out its window instead. The mirror of the two-askers case above, and the reason a single
// answering peer cannot show it: the first answer always gets through.
//
// The asking node is the only real node in the fleet, because any other would reach the
// source itself and its fetch would stand in for the one being measured.
//
// The window is a minute and the assertion is thirty seconds, so "settled on the answers"
// and "settled on the window" cannot be confused for one another.
describe('a node acts on every peer that answers, not just the first', function () {
  let env;
  const ASKER = 0;
  const STUBS = [1, 2];

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      stubPeers: STUBS,
      // Both wired to the one real node, so it has two peers to ask and they are the only
      // peers it has.
      stubPeeredWith: { [STUBS[0]]: [ASKER], [STUBS[1]]: [ASKER] },
      policy: { available: false },
      awaitPolicy: false,
      configOverrides: {
        policy: {
          // The tick is the other route to the source and would answer for the seed. A week
          // puts it out of reach of a run.
          refreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
          peerWindowMs: 60000,
        },
      },
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('reaches the source once its peers have answered, not once their asks expire', async function () {
    this.timeout(300000);
    await Promise.all(STUBS.map((i) => env.stubPeerClients.get(i).answerPolicyWith(null)));
    await stub(env, '/policy', { available: true });
    const before = (await stubState(env)).policyFetches.total;

    // Restarted so the asks happen now rather than during boot, where the source was down
    // and the measurement would be of the wrong round.
    await env.restartNode(ASKER);
    await waitForBootSettled(env.clients[ASKER]);

    // THE FIXTURE'S OWN PRECONDITION. One stub answering is the case that always worked, so
    // without this the assertion below could pass on a fleet where only one peer was ever
    // asked - which is not the thing being tested.
    await waitFor(
      async () => {
        const answered = await Promise.all(
          STUBS.map((i) => env.stubPeerClients.get(i).policyAsksAnswered()),
        );
        return answered.every((n) => n >= 1);
      },
      { timeout: 120000, interval: 2000, label: 'both peers to have answered an ask' },
    );

    await waitFor(
      async () => (await stubState(env)).policyFetches.total > before,
      {
        timeout: 30000,
        interval: 1000,
        label: 'the node to seed from the source once both of its peers had answered',
      },
    );
  });
});

// THE FIRST WAVE OF A ROLLOUT. Every peer this node has predates the policy protocol, so
// there is nobody it can ask - and a node that reached the source only as a consequence of
// some peer having answered would hold nothing at all until its own tick, a day away, with
// the acquisition gate shut for the whole of it.
//
// The tick is a week out and the peers cannot answer, so the arrival of a peer that cannot
// answer is the only thing left that can reach the source. That is the case, exactly.
//
// The asking node is the only real node in the fleet: any other would reach the source
// itself and its fetch would stand in for the one being measured.
describe('a node whose peers all predate the policy protocol', function () {
  let env;
  const ASKER = 0;
  const STUBS = [1, 2];

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      stubPeers: STUBS,
      // Advertising no policyBundle capability, which is what every peer looks like to the
      // first node in the fleet to carry this release.
      policyUnawarePeers: STUBS,
      stubPeeredWith: { [STUBS[0]]: [ASKER], [STUBS[1]]: [ASKER] },
      policy: { available: false },
      awaitPolicy: false,
      configOverrides: {
        policy: {
          // The tick is the other route to the source and would answer for the seed. A week
          // puts it out of reach of a run.
          refreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
          peerWindowMs: 60000,
        },
      },
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks none of them, announces to none of them, and still reaches the source', async function () {
    this.timeout(300000);
    // Both stubs set to ANSWER, so that an ask reaching one is counted. Left silent they
    // would count nothing whether or not they were asked, and the assertion below could
    // not fail.
    await Promise.all(STUBS.map((i) => env.stubPeerClients.get(i).answerPolicyWith(7)));
    await stub(env, '/policy', { available: true });

    // Restarted so the peerings, and any ask they would produce, happen after the stubs
    // were told to answer. It comes back holding nothing: the source was down for its
    // first boot, so there is nothing on disk to restore.
    await env.restartNode(ASKER);
    await waitForBootSettled(env.clients[ASKER]);

    await waitFor(
      async () => (await heldSeq(ASKER)) !== null,
      { timeout: 180000, interval: 2000, label: 'the node to seed from the published source' },
    );
    expect(await heldSeq(ASKER), 'and it holds what the source published')
      .to.equal((await stubState(env)).policySeq);

    const asked = await Promise.all(
      STUBS.map((i) => env.stubPeerClients.get(i).policyAsksAnswered()),
    );
    expect(asked, 'a peer with no handler for the question is never asked it').to.deep.equal([0, 0]);

    const told = await Promise.all(
      STUBS.map((i) => env.stubPeerClients.get(i).policyAnnouncementsReceived()),
    );
    expect(told, 'nor told what this node adopted').to.deep.equal([0, 0]);
  });
});

// A sequence is a claim the asker cannot check, so how MANY peers make it is what decides
// whether their agreement is worth anything. The publisher's answer is signed and stands on
// its own; a peer's is one node's word, and a stale or lying neighbour would otherwise open
// the acquisition gate on policy the network has moved past.
//
// This fleet can field two answering peers and the node is told it takes three, so what its
// peers say is true, unverifiable, and not enough. The bundle is on disk throughout: holding
// one is what makes this the interesting case, because holding is not confirming and the node
// has to go on refusing to act on something it already has.
describe('a node does not open its gate on fewer peers than it takes', function () {
  let env;
  const NODE = 0;
  const STUBS = [1, 2];
  let held = null;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      stubPeers: STUBS,
      stubPeeredWith: { [STUBS[0]]: [NODE], [STUBS[1]]: [NODE] },
      configOverrides: {
        policy: {
          // One more than this fleet can field, so the peer rung cannot carry it on its own
          // and the decision has to fall through to the publisher.
          minConfirmingPeers: STUBS.length + 1,
          // The tick is the other route to the source and would answer for the rung under
          // test. A week puts it out of reach of a run.
          refreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
          peerWindowMs: 60000,
        },
      },
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds what its peers agree on, and still refuses to act on it', async function () {
    this.timeout(300000);
    held = await heldSeq(NODE);
    expect(held, 'it boots holding the published bundle').to.not.be.null;

    // Both stubs answer "I am level with you" - true, unverifiable, and one short of what it
    // takes. Set to ANSWER before the restart so that an ask reaching one is counted: left
    // silent they would count nothing whether or not they were asked, and the assertion that
    // they were consulted could not fail.
    await Promise.all(STUBS.map((i) => env.stubPeerClients.get(i).answerPolicyWith(held)));
    // Resets the stub's fetch counters, so what they read below is this boot's traffic.
    await stub(env, '/policy', { available: false });

    await env.restartNode(NODE);
    await waitForBootSettled(env.clients[NODE]);

    expect(await heldSeq(NODE), 'the bundle is back off disk').to.equal(held);
    await waitFor(
      async () => (await Promise.all(
        STUBS.map((i) => env.stubPeerClients.get(i).policyAsksAnswered()),
      )).every((n) => n > 0),
      { timeout: 120000, interval: 2000, label: 'both peers to answer the ask' },
    );

    // THE RUNG UNDER TEST. Two peers agreed and it asked the publisher anyway, which is the
    // whole point: a node holding a bundle its peers cannot settle does not stop there.
    await waitFor(
      async () => (await stubState(env)).policyFetches.total > 0,
      { timeout: 120000, interval: 2000, label: 'the node to ask the publisher as well' },
    );
    expect((await stubState(env)).policyFetches.ok, 'which had nothing to give it').to.equal(0);

    const blocked = await env.clients[NODE].waitForEvent(
      'spawner:blocked',
      (payload) => payload.reason === 'policy_not_ready',
      240000,
    );
    expect(blocked.data.reason, 'held, agreed with, and still not acted on').to.equal('policy_not_ready');
  });

  it('opens it once the publisher settles what its peers could not', async function () {
    this.timeout(300000);
    // Published anew, so what comes back is adopted and therefore says which rung it came
    // from. The stubs stay where they were, so the peer rung goes on answering "not ahead"
    // and goes on being one short.
    await stub(env, '/policy', { available: true });
    const published = (await stubState(env)).policySeq;
    expect(published, 'the publisher is ahead of what the node holds').to.be.greaterThan(held);

    await env.restartNode(NODE);
    await waitForBootSettled(env.clients[NODE]);

    await waitFor(
      async () => (await heldSeq(NODE)) === published,
      { timeout: 240000, interval: 2000, label: `node ${NODE} to reach seq ${published}` },
    );
    const rungs = env.clients[NODE].getEventBuffer()
      .filter((e) => e.event === 'policy:bundleChanged' && e.data.seq === published)
      .map((e) => e.data.source);
    expect(rungs, 'by the one route its peer set could not stand in for').to.include('backstop');
    expect((await stubState(env)).policyFetches.ok, 'and the publisher answered it').to.be.greaterThan(0);
  });
});
