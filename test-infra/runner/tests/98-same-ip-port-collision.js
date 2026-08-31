// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  bootAndPeer, installOnNodes, seedSpawnerApp,
} from '../framework/reconciler-suite.js';
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
const FREE_PORT = 31222;

const STUB_PEERS = [2, 3, 4];

describe('a port another Flux node at this address holds', function () {
  let env;
  let subnet;
  let askerIp;
  let siblingIp;
  dumpLogsOnFailure(() => env);

  // Log lines this node has produced since its container was created.
  const linesFor = (index) => env.nodeDiagnostics().find((n) => n.index === index)?.lines ?? [];

  const sawLine = (index, pattern, timeout = 180000) => waitFor(
    () => linesFor(index).some((line) => pattern.test(line)),
    { timeout, label: `node ${index} logs ${pattern}` },
  );

  // An app wanting one named port, for either deployment path.
  const appWanting = async (name, port) => {
    await pushImage(name, 'v1');
    return buildSeedableApp({
      name,
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

    const answer = await env.clients[1].get('/flux/portsinuse');

    expect(answer.status).to.equal('success');
    expect(answer.data).to.be.an('array');
    expect(answer.data).to.include(HELD_PORT);
  });

  // Unauthenticated and reachable by anyone, and a cold answer can reach
  // fluxbenchd to decrypt a specification - so the cache in front of it must
  // stay a cache. Without the guard a caller varies a parameter and every
  // request is a fresh miss, because apicache keys on the whole URL.
  it('takes no query parameters', async function () {
    this.timeout(30000);
    const answer = await env.clients[1].get('/flux/portsinuse?whatever=1');

    expect(answer.status).to.equal('error');
    expect(answer.data.message).to.match(/no query parameters/i);
  });

  // The front door. The asker reports itself at the sibling's address on a
  // different api port, which is what a second node behind one router does.
  it('refuses an install onto a port a Flux node at this address holds', async function () {
    this.timeout(600000);
    await setNodeAddress(askerIp, `${siblingIp}:${SIBLING_API_PORT}`, { scope: 'all' });

    const app = await appWanting('siblingheldapp', HELD_PORT);
    await seedSpawnerApp(env, app);

    await sawLine(0, new RegExp(`port ${HELD_PORT} is held by the Flux node at ${siblingIp.replace(/\./g, '\\.')}`), 420000);
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
    // Only the stubs may be drawn, so every possible answer is the foreign one.
    await removeFromNodeList(siblingIp);
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeForeign(true)));

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
    await sawLine(0, /is answered by something other than this node at this address/);
    await sawLine(0, /are not available publicly/);
    await Promise.all(STUB_PEERS.map((i) => env.stubPeerClients.get(i).answerPortProbeForeign(false)));
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

    const app = await appWanting('oldpeersapp', FREE_PORT);
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

    const app = await appWanting('sightedprobeapp', FREE_PORT);
    await seedSpawnerApp(env, app);

    await waitFor(async () => {
      const res = await env.clients[0].getInstalledApps();
      return res.status === 'success' && res.data.some((a) => a.name === 'sightedprobeapp');
    }, { timeout: 300000, label: 'sightedprobeapp installs once peers connect' });
  });
});
