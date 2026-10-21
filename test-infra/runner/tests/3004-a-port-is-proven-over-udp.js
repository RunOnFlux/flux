// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForAppInstalled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Every app port is published for TCP and UDP, so a node proves both before it
// installs an app, and its availability check proves both on a port of its own.
//
// UDP has no handshake: silence is all a closed port and a lost datagram say. A
// peer probes each port and hands back what replied; only the node's own token
// coming back proves a port, and a refusal needs two distinct peers that heard
// nothing. The shapes put the fault in the node's own namespace:
//
//   udp-blocked     no datagram starting a flow arrives - a router forwarding TCP
//                   alone. Refused, and the availability check reports it.
//   udp-first-lost  the first datagram from each source is lost, every later one
//                   arrives. A probe that sends once never gets through; one that
//                   sends again always does. Proven.
//
// The peers in the first fleet are real nodes on this branch. The second fleet's
// peers are stubs that read TCP and do not probe UDP - the state of the network
// while it updates - and a node there must install on TCP proof alone.

const subnet = getSubnetConfig();
const socketAddressOf = (index) => `${subnet.nodeIp(index + 1)}:16127`;

// The availability check's waits, compressed: a pass after a failure comes a
// second later, and a confirmed failure takes two passes.
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: 10 * 60 * 1000, error: 5000, failure: 1000, dos: 5 * 60 * 1000, appError: 5000,
  },
  thresholds: { dos: 100, portsHighEdge: 3, portsLowEdge: 1 },
};

// Enough attempts that a node always reaches two peers that answer.
const PORT_TEST = { portTestMaxAttempts: 3 };

const appPinnedTo = async (name, port, index) => {
  await pushImage(name, 'v1');
  return buildSeedableApp({
    name,
    instances: 1,
    nodes: [socketAddressOf(index)],
    compose: [{
      name,
      description: 'one port, proven before install',
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

const udpCheck = async (client) => (await client.get('/flux/health').catch(() => null))?.data?.udp;

describe('a port is proven over UDP', function () {
  const OPEN = 0;
  const BLOCKED = 1;
  const FIRST_LOST = 2;
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      networkShapes: { [BLOCKED]: 'udp-blocked', [FIRST_LOST]: 'udp-first-lost' },
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, ...PORT_TEST } },
      nodeConfigOverrides: {
        [OPEN]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
        [BLOCKED]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('installs on a node whose port answers over TCP and UDP, proven by one peer', async function () {
    this.timeout(420000);
    const after = env.clients[OPEN].getLastEventId();
    const app = await appPinnedTo('udpopenapp', 31141, OPEN);
    await seedSpawnerApp(env, app);

    const proven = await env.clients[OPEN].waitForEvent('ports:proven', (d) => d.ports.includes(31141), 420000, { afterId: after });
    expect(proven.data.reason).to.equal('proven');
    await waitForAppInstalled(env.clients[OPEN], 'udpopenapp', 300000, { afterId: after });
  });

  it('refuses a port two peers hear nothing on over UDP', async function () {
    this.timeout(420000);
    const after = env.clients[BLOCKED].getLastEventId();
    const app = await appPinnedTo('udpblockedapp', 31142, BLOCKED);
    await seedSpawnerApp(env, app);

    const refused = await env.clients[BLOCKED].waitForEvent('ports:udpUnreachable', (d) => d.port === 31142, 420000, { afterId: after });
    expect(refused.data.reason).to.equal('udpUnreachable');
    expect(refused.data.peers).to.have.length(2);
    expect(new Set(refused.data.peers).size).to.equal(2);
    await env.clients[BLOCKED].waitForEvent(
      'spawner:deferred',
      (d) => d.appName === 'udpblockedapp' && d.reason === 'ports_not_available',
      60000,
      { afterId: after },
    );
    const installed = await env.clients[BLOCKED].getInstalledApps();
    expect(installed.data.map((a) => a.name)).to.not.include('udpblockedapp');
  });

  it('proves a port whose first datagram from each peer is lost', async function () {
    this.timeout(420000);
    const after = env.clients[FIRST_LOST].getLastEventId();
    const app = await appPinnedTo('udplossyapp', 31143, FIRST_LOST);
    await seedSpawnerApp(env, app);

    const proven = await env.clients[FIRST_LOST].waitForEvent('ports:proven', (d) => d.ports.includes(31143), 420000, { afterId: after });
    expect(proven.data.reason).to.equal('proven');
    await waitForAppInstalled(env.clients[FIRST_LOST], 'udplossyapp', 300000, { afterId: after });
  });

  // Two peers' silence is reported in health. Taking the node out of service for
  // it waits on a policy document this fleet's policy does not carry.
  it('reports UDP degraded in health, and stays in service, when the availability check confirms the failure', async function () {
    this.timeout(600000);
    await waitFor(async () => (await udpCheck(env.clients[BLOCKED])) === 'degraded', {
      timeout: 540000, interval: 5000, label: 'the blocked node reports udp degraded',
    });
    await waitFor(async () => (await udpCheck(env.clients[OPEN])) === 'ok', {
      timeout: 60000, interval: 5000, label: 'the open node reports udp ok',
    });
    const dos = (await env.clients[BLOCKED].getDOSState()).data;
    expect(dos.dosMessage).to.equal(null);
  });
});

describe('a node whose peers do not probe UDP', function () {
  const NODE = 0;
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      stubPeers: [1, 2, 3],
      networkShapes: { [NODE]: 'udp-blocked' },
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, ...PORT_TEST } },
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  // The first nodes to update have almost no peer that probes UDP. Silence they
  // cannot get is not silence, so they install on TCP proof as before.
  it('installs on TCP proof, its UDP unproven', async function () {
    this.timeout(420000);
    const after = env.clients[NODE].getLastEventId();
    const app = await appPinnedTo('udpoldpeersapp', 31144, NODE);
    await seedSpawnerApp(env, app);

    const unproven = await env.clients[NODE].waitForEvent('ports:unproven', () => true, 420000, { afterId: after });
    expect(unproven.data.reason).to.equal('udpUnproven');
    expect(unproven.data.peers).to.deep.equal([]);
    await waitForAppInstalled(env.clients[NODE], 'udpoldpeersapp', 300000, { afterId: after });
  });
});
