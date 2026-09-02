// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  bootAndPeer, installOnNodes, seedSpawnerApp,
} from '../framework/reconciler-suite.js';
import { authenticate, signBtcMessage } from '../auth.js';
import { fluxTeamKey, nodeKey } from '../framework/keys.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import {
  setNodeAddress, clearNodeAddress, removeFromNodeList, restoreToNodeList,
} from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Several Flux nodes commonly share one public IP - four behind one home router
// is an ordinary setup. Each is its own machine with its own docker and its own
// app database, so each binds a host port successfully and nothing local
// objects. The router forwards that port to exactly one of them.
//
// Every other node's app is then unreachable from the moment it starts, and
// nothing reports it: the container binds fine in its own namespace, its
// healthchecks pass, and the instance is broadcast to the network as live.
//
// Two things stop it here, and this suite drives both through a real fleet.
//
// The FRONT DOOR asks the other Flux nodes at this address which ports they
// hold, before the firewall is opened or anything is mapped, so a refusal costs
// nothing to unwind. That is /flux/portsinuse.
//
// The DECIDER is the pre-install port test. A peer reports that something
// answered at this node's public address; where the address is shared, what
// answered can be a sibling's application while this node's own test server sat
// unreached. The peer cannot tell - from outside there is nothing to tell - so
// the node reads its own test server instead.
//
// The topology is REAL, not simulated. setNodeAddress moves what benchmark tells
// a node about itself and what the network carries for it, leaving the container
// where it is - so a node genuinely reports itself at another node's address on
// its own api port, which is exactly the production shape (several nodes, one
// address, different api ports). Its sibling is a real FluxOS answering the real
// endpoint.
const SIBLING_API_PORT = 16137;

// The port the sibling holds, and the one the spawner is then offered.
const HELD_PORT = 31111;
// A port per test that actually INSTALLS. Only one of the three below is
// refused, and the two that succeed each leave their app in place on node 0 -
// so sharing a port between them means the second is refused for holding its
// own predecessor's port rather than for anything the test is about. That is
// the same collision suite 37 lost a gate to, one layer over.
const FREE_PORT = 31122;      // test 4: refused, never installs
const OLD_PEER_PORT = 31123;  // test 5: installs and stays
const SIGHTED_PORT = 31124;   // test 6: installs and stays
const LONE_DISSENT_PORT = 31125; // test 5: installs, one peer dissenting

const STUB_PEERS = [2, 3, 4];

describe('a port another Flux node at this address holds', function () {
  let env;
  let subnet;
  let askerIp;
  let siblingIp;
  dumpLogsOnFailure(() => env);

  // An app wanting one named port, for either deployment path.
  // The whole suite rests on two apps wanting one port, which is exactly what
  // buildSeedableApp refuses by default. Said out loud, once, here.
  const appWanting = async (name, port) => {
    await pushImage(name, 'v1');
    return buildSeedableApp({
      name,
      allowPortReuse: true,
      compose: [{
        name,
        description: 'test container',
        repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
        ports: [port],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, stubPeers: STUB_PEERS });
    subnet = getSubnetConfig();
    askerIp = subnet.nodeIp(1);
    siblingIp = subnet.nodeIp(2);
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await clearNodeAddress(askerIp).catch(() => {});
    await restoreToNodeList(siblingIp).catch(() => {});
    await env?.teardown();
  });

  it('reports the ports the node has installed', async function () {
    this.timeout(300000);
    // Targeted rather than spawned: the sibling test below has to know which
    // node holds the port, and the spawner picks its own.
    const app = await appWanting('heldportapp', HELD_PORT);
    await installOnNodes(env, app, [1]);

    // A POST carrying operator auth. The endpoint answers a Fluxnode that signed
    // the question or an operator that is entitled to ask; a test is the latter.
    const auth = await authenticate(env.clients[1].url, fluxTeamKey());
    const answer = await env.clients[1].post('/flux/portsinuse', {}, { zelidauth: auth.zelidauth });

    expect(answer.status).to.equal('success');
    expect(answer.data.ports).to.be.an('array');
    expect(answer.data.ports).to.include(HELD_PORT);

    // The answer is SIGNED, and that is the whole reason to act on it. A node's
    // own record of what it has installed is the truth about which ports are
    // spoken for at this address - but only once it is that node saying it,
    // rather than whatever happens to be listening on the address. Asserted here
    // because this is the only place a real FluxOS answers this endpoint; the
    // sibling test below then proves the other end verifies it.
    expect(answer.data.pubKey, 'the answer named no signer').to.be.a('string');
    expect(answer.data.signature, 'the answer was not signed').to.be.a('string');
  });

  // Answering is not free: it reads this node's own specifications and decrypts
  // the enterprise ones. Open, an anonymous caller could ask for that as often
  // as it liked, so the question has to come from a Fluxnode that signed it or
  // an operator entitled to ask.
  //
  // This replaces a test that asserted the endpoint took no query parameters.
  // That guard existed because the route was an unauthenticated cached GET, and
  // it went when the route did - a POST has no URL to vary and no response cache
  // to poison. Asserting the guard that exists now rather than deleting the test
  // and leaving the new contract uncovered.
  it('refuses a caller that neither signed nor is entitled to ask', async function () {
    this.timeout(30000);
    const answer = await env.clients[1].post('/flux/portsinuse', {});

    expect(answer.status).to.equal('error');
    expect(answer.data.message).to.match(/verify request authenticity/i);
  });

  // The keep-alive is the availability endpoint's twin: a signed peer asks this
  // node to connect to its ports, and the address it connects to is the one the
  // caller came from, never one the body names. Driven from the runner because
  // no node in this fleet is behind UPnP, so nothing here sends the ask itself.
  // What this proves that a unit test cannot: a real FluxOS answers it through
  // express.json() and a real socket, and the refusal is a bare status code.
  it('keeps UPnP ports alive at the address that asked, not the one named', async function () {
    this.timeout(60000);
    const asker = nodeKey(5);
    const ask = {
      ip: subnet.nodeIp(5), apiPort: 16127, ports: [], pubKey: asker.pubkey, timestamp: Math.floor(Date.now() / 1000),
    };
    const signature = await signBtcMessage(JSON.stringify(ask), asker.privkey);

    // Signed by a listed Fluxnode and sent from here, which is not that node.
    // The connect-back goes to this runner, where nothing listens, and fails;
    // were the body's address used it would reach node 5 and succeed.
    const fromHere = await env.clients[1].request('POST', '/flux/keepupnpportsopen', { body: { ...ask, signature } });
    expect(fromHere.status, 'the body address was used to pick the target').to.equal(503);

    // Flux team may name one, and the connect-back then reaches the node named.
    const auth = await authenticate(env.clients[1].url, fluxTeamKey());
    const named = await env.clients[1].request('POST', '/flux/keepupnpportsopen', { body: ask, headers: { zelidauth: auth.zelidauth } });
    expect(named.status, 'the carve-out was lost').to.equal(202);
  });

  // The front door. The asker reports itself at the sibling's address on a
  // different api port, which is what a second node behind one router does.
  it('refuses an install onto a port a Flux node at this address holds', async function () {
    this.timeout(600000);
    await setNodeAddress(askerIp, `${siblingIp}:${SIBLING_API_PORT}`, { scope: 'all' });

    // Anchored before the seed: an unanchored wait answers from the buffer, and
    // this suite publishes these same names in more than one test.
    const siblingAfter = env.clients[0].getLastEventId();
    const app = await appWanting('siblingheldapp', HELD_PORT);
    await seedSpawnerApp(env, app);

    const held = await env.clients[0].waitForEvent(
      'spawner:deferred',
      (d) => d.reason === 'sibling_holds_port' && d.appName === 'siblingheldapp',
      420000,
      { afterId: siblingAfter },
    );

    // The sibling and the port are named, so this cannot pass on a deferral for
    // one of the seven other reasons the spawner stands down for.
    expect(held.data.port).to.equal(HELD_PORT);
    expect(held.data.address).to.contain(siblingIp);
  });

  // The decider. Every peer that could be asked answers a pass without ever
  // connecting, which is what the asker receives when the router forwarded its
  // port to a sibling: something answered, and it was not this node.
  // The collision, as the asker experiences it: every peer that could be drawn
  // reads the port and finds an application that is not this node's, which is
  // what comes back when the router forwarded that port to a neighbour.
  it('refuses a port answered by an application that is not this node\'s', async function () {
    this.timeout(420000);
    await clearNodeAddress(askerIp);
    // Only the stubs may be drawn, so every possible answer is the foreign one -
    // and node 0 has to have READ the removal before anything is seeded. The
    // list is polled on a timer, so removing the sibling and seeding straight
    // after leaves a window in which node 0 still draws it. It is a real node:
    // it reads node 0's port honestly, finds node 0's own test server, returns
    // the true token, and the install proceeds. The test then fails saying the
    // refusal never came, which is true and entirely misleading.
    //
    // networkstate:updated exists for this, and is anchored because an
    // unanchored wait answers from the buffer on a refresh that happened before
    // the removal.
    const afterId = env.clients[0].getLastEventId();
    await removeFromNodeList(siblingIp);
    await env.clients[0].waitForEvent('networkstate:updated', () => true, 60000, { afterId });
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeForeign(true)));

    const foreignAfter = env.clients[0].getLastEventId();
    const app = await appWanting('foreignanswerapp', FREE_PORT);
    await seedSpawnerApp(env, app);

    // Matched on the token comparison failing, not on the install being
    // refused. "are not available publicly" is the generic message every port
    // failure ends at, so asserting only that proves an install was refused and
    // nothing about why - and a refusal for the wrong reason wears those same
    // words. One did: an earlier version of this check watched for the peer's
    // connection instead of reading a token back, could not see it at all
    // because the peer resets the connection, and refused real installs across
    // a whole fleet while logging exactly that generic line.
    const refused = await env.clients[0].waitForEvent(
      'ports:notOurs',
      (d) => d.port === FREE_PORT,
      420000,
      { afterId: foreignAfter },
    );

    // Two distinct peers, not one asked twice: the rule is corroboration and the
    // event carries who, so the test asserts that rather than a count in prose.
    expect(refused.data.peers).to.have.length.greaterThanOrEqual(2);
    expect(new Set(refused.data.peers).size).to.equal(refused.data.peers.length);
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeForeign(false)));
  });

  // One peer's word does not stop an install, and this is the case the rule was
  // written for. Our own token coming back is PROOF - only this node could have
  // produced it - so one peer settles an acceptance. Anything else is one
  // observer's report about a third party, and a report can be wrong: a
  // truncated read, something in the path, a peer having a bad moment. Refusing
  // on the first of those leaves a node that quietly installs nothing.
  //
  // Exactly one peer is drawable here, and it dissents on every attempt. So the
  // node spends its whole retry budget on a single witness and must still
  // proceed - which also proves the tally counts WITNESSES rather than readings,
  // since the same peer answering five times is still one peer.
  it('does not refuse on one peer\'s reading when no second peer can be asked', async function () {
    this.timeout(420000);
    const [lone, ...silenced] = STUB_PEERS;

    // Deterministic rather than probabilistic: with three peers and one
    // dissenting, the draw decides whether the old rule refused, and a test that
    // is only sometimes red is not evidence. Leaving one drawable peer makes the
    // old behaviour fail every time and the new one pass every time.
    const afterRemoval = env.clients[0].getLastEventId();
    await Promise.all(silenced.map((i) => removeFromNodeList(subnet.nodeIp(i + 1))));
    await env.clients[0].waitForEvent('networkstate:updated', () => true, 60000, { afterId: afterRemoval });

    await env.stubPeerClients.get(lone).answerPortProbeForeign(true);

    const loneAfter = env.clients[0].getLastEventId();
    const app = await appWanting('lonedissentapp', LONE_DISSENT_PORT);
    await seedSpawnerApp(env, app);

    await waitFor(async () => {
      const res = await env.clients[0].getInstalledApps();
      return res.status === 'success' && res.data.some((a) => a.name === 'lonedissentapp');
    }, { timeout: 300000, label: 'lonedissentapp installs despite a single dissenting peer' });

    // Asserted on the reason, not on a sentence. The peer WAS asked and did
    // disagree, so this is not the same state as there being nobody outside this
    // address at all - and the event says which, where a log line saying
    // "proceeding on reachability alone" covers both.
    const unproven = await env.clients[0].waitForEvent(
      'ports:unproven',
      (d) => d.reason === 'noOtherObserver',
      420000,
      { afterId: loneAfter },
    );

    expect(unproven.data.peers).to.have.length(1);

    await env.stubPeerClients.get(lone).answerPortProbeForeign(false);
    const afterRestore = env.clients[0].getLastEventId();
    await Promise.all(silenced.map((i) => restoreToNodeList(subnet.nodeIp(i + 1))));
    await env.clients[0].waitForEvent('networkstate:updated', () => true, 60000, { afterId: afterRestore });
  });

  // The early adopter, and it is the case that decides whether this can ship in
  // one go. The first nodes to take this update have almost no peers that can
  // read a port back yet. If "cannot prove it" were treated as "disproved it",
  // every one of them would refuse every install until the rest of the network
  // caught up - so a peer that answers without a reading must leave the node
  // exactly where it was before, not worse.
  it('still installs when no peer is new enough to read the port back', async function () {
    this.timeout(420000);
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeBlind(true)));

    const app = await appWanting('oldpeersapp', OLD_PEER_PORT);
    await seedSpawnerApp(env, app);

    await waitFor(async () => {
      const res = await env.clients[0].getInstalledApps();
      return res.status === 'success' && res.data.some((a) => a.name === 'oldpeersapp');
    }, { timeout: 300000, label: 'oldpeersapp installs with only old peers to ask' });
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeBlind(false)));
  });

  // The control, and it is the point: the refusal above has to be caused by the
  // blindness rather than by anything else a fleet this size puts in the way.
  //
  // A FRESH app, not the refused one. An app a node stands down over keeps the
  // entry every selection takes in the spawn cache, so it is deliberately not
  // reconsidered - the refusal is durable by design and waiting for a retry
  // would be waiting for something that should never come. Same node, same
  // fleet, same port range, peers that now really connect.
  it('installs an app of the same shape once the peers read the real port', async function () {
    this.timeout(420000);
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeBlind(false)));
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeForeign(false)));

    const app = await appWanting('sightedprobeapp', SIGHTED_PORT);
    await seedSpawnerApp(env, app);

    await waitFor(async () => {
      const res = await env.clients[0].getInstalledApps();
      return res.status === 'success' && res.data.some((a) => a.name === 'sightedprobeapp');
    }, { timeout: 300000, label: 'sightedprobeapp installs once peers connect' });
  });
});
