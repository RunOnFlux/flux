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
import { execInContainer, restartFluxos, setNodeApiPort } from '../framework/container.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { waitFor, waitForAppInstalled, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Every app port is published for TCP and UDP, so a node proves both before it
// installs an app, and its availability check proves both on a port of its own.
//
// UDP has no handshake: silence is all a closed port and a lost datagram say. A
// peer probes each port and hands back what replied; only the node's own token
// coming back proves a port, and a refusal needs two distinct peers that heard
// nothing. The shapes put the fault in the node's own namespace, on its fleet
// device:
//
//   udp-blocked      no datagram starting a flow arrives - a router forwarding TCP
//                    alone. Refused, and the availability check reports it.
//   udp-first-lost   the first datagram from each source is lost, every later one
//                    arrives. A probe that sends once never gets through; one that
//                    sends again always does. Proven.
//   udp-every-other  every other datagram is lost, whatever its source. Proven.
//
// The open node runs ufw as an install leaves it, so its UDP test rule is what
// admits the probes, and it is gone once the test ends. The every-other node is
// behind a UPnP gateway, which must be asked for both protocols of the port.
//
// The peers in the first two fleets are real nodes on this branch. The last
// fleet's peers are stubs that read TCP and do not probe UDP - the state of the
// network while it updates - and a node there must install on TCP proof alone.

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

const PORTS_DOS_PREFIX = 'Ports tested not reachable from outside';

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

// A fit node answers with its checks as the data; an unfit one, under data.checks.
const udpCheck = async (client) => {
  const health = await client.get('/flux/health').catch(() => null);
  return health?.status === 'success' ? health.data?.udp : health?.data?.checks?.udp;
};

// Seeds an app pinned to one node and waits for that node's port test to prove
// its port, then for the install.
const provenAndInstalled = async (env, index, name, port) => {
  const client = env.clients[index];
  const after = client.getLastEventId();
  await seedSpawnerApp(env, await appPinnedTo(name, port, index));
  const proven = await client.waitForEvent('ports:proven', (d) => d.ports.includes(port), 420000, { afterId: after });
  expect(proven.data.reason).to.equal('proven');
  await waitForAppInstalled(client, name, 300000, { afterId: after });
};

describe('a port is proven over UDP', function () {
  const OPEN = 0;
  const BLOCKED = 1;
  const FIRST_LOST = 2;
  const EVERY_OTHER = 3;
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      firewall: [OPEN],
      networkShapes: { [BLOCKED]: 'udp-blocked', [FIRST_LOST]: 'udp-first-lost', [EVERY_OTHER]: 'udp-every-other' },
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, ...PORT_TEST } },
      nodeConfigOverrides: {
        [OPEN]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
        [BLOCKED]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
      },
    });
    // the first boot writes userconfig.js (its identity); a node with an api port
    // in it verifies UPnP when it starts
    const upnp = env.clients[EVERY_OTHER];
    await waitForBootSettled(upnp);
    await enableUpnpGateway(subnet.nodeIp(EVERY_OTHER + 1));
    await setNodeApiPort(upnp.container, 16127);
    await restartFluxos(upnp.container);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('installs on a firewalled node whose port answers over TCP and UDP, and leaves no test rule behind', async function () {
    this.timeout(720000);
    await provenAndInstalled(env, OPEN, 'udpopenapp', 31141);

    const rules = (await execInContainer(env.clients[OPEN].container, 'ufw status; true')).stdout
      .split('\n').map((line) => line.trim()).filter((line) => line.startsWith('31141'));
    expect(rules.some((line) => /^31141\s/.test(line)), 'canary: the app\'s own rule for its port').to.equal(true);
    expect(rules.filter((line) => line.includes('/udp') || line.includes('/tcp')), 'a test rule left behind').to.deep.equal([]);
  });

  it('refuses a port two peers hear nothing on over UDP', async function () {
    this.timeout(420000);
    const client = env.clients[BLOCKED];
    const after = client.getLastEventId();
    await seedSpawnerApp(env, await appPinnedTo('udpblockedapp', 31142, BLOCKED));

    const refused = await client.waitForEvent('ports:udpUnreachable', (d) => d.port === 31142, 420000, { afterId: after });
    expect(refused.data.reason).to.equal('udpUnreachable');
    expect(refused.data.peers).to.have.length(2);
    expect(new Set(refused.data.peers).size).to.equal(2);
    await client.waitForEvent(
      'spawner:deferred',
      (d) => d.appName === 'udpblockedapp' && d.reason === 'ports_not_available',
      60000,
      { afterId: after },
    );
    const installed = await client.getInstalledApps();
    expect(installed.data.map((a) => a.name)).to.not.include('udpblockedapp');
  });

  it('proves a port whose first datagram from each peer is lost', async function () {
    this.timeout(720000);
    await provenAndInstalled(env, FIRST_LOST, 'udplossyapp', 31143);
  });

  it('proves a port that loses every other datagram, behind UPnP mapped for both protocols', async function () {
    this.timeout(720000);
    await provenAndInstalled(env, EVERY_OTHER, 'udpsteadylossapp', 31145);

    const { requests } = await upnpGatewayState(subnet.nodeIp(EVERY_OTHER + 1));
    const mapped = requests.filter((r) => r.action === 'AddPortMapping' && r.port === 31145 && r.description === 'Flux_App_udpsteadylossapp');
    expect([...new Set(mapped.map((r) => r.protocol))].sort()).to.deep.equal(['TCP', 'UDP']);
  });

  // Two peers' silence is reported in health. Taking the node out of service for
  // it waits on a policy document this fleet's policy does not carry.
  it('reports UDP degraded in health, and stays in service, when the availability check confirms the failure', async function () {
    this.timeout(600000);
    await waitFor(async () => (await udpCheck(env.clients[BLOCKED])) === 'degraded', {
      timeout: 540000, interval: 5000, label: 'the blocked node reports udp degraded',
    });
    await waitFor(async () => (await udpCheck(env.clients[OPEN])) === 'ok', {
      timeout: 60000, interval: 5000, label: 'the firewalled open node reports udp ok',
    });
    const dos = (await env.clients[BLOCKED].getDOSState()).data;
    expect(dos.dosMessage).to.equal(null);
  });
});

describe('a port closed over UDP, with the policy that counts it', function () {
  const BLOCKED = 0;
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      networkShapes: { [BLOCKED]: 'udp-blocked' },
      policy: { documents: { udpportdos: true } },
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, ...PORT_TEST } },
      // the first port failure is walked, the next counts, and one count is the threshold
      nodeConfigOverrides: {
        [BLOCKED]: { fluxapps: { appsPortCheck: { ...APPS_PORT_CHECK, thresholds: { dos: 4, portsHighEdge: 1, portsLowEdge: 0 } } } },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes the node out of service once the failures it confirms reach the threshold', async function () {
    this.timeout(600000);
    await waitFor(async () => (await env.clients[BLOCKED].getDOSState()).data?.dosMessage?.startsWith(PORTS_DOS_PREFIX) === true, {
      timeout: 540000, interval: 5000, label: 'the blocked node is out of service for its ports',
    });
    expect(await udpCheck(env.clients[BLOCKED])).to.equal('degraded');
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
    const client = env.clients[NODE];
    const after = client.getLastEventId();
    await seedSpawnerApp(env, await appPinnedTo('udpoldpeersapp', 31144, NODE));

    const unproven = await client.waitForEvent('ports:unproven', () => true, 420000, { afterId: after });
    expect(unproven.data.reason).to.equal('udpUnproven');
    expect(unproven.data.peers).to.deep.equal([]);
    await waitForAppInstalled(client, 'udpoldpeersapp', 300000, { afterId: after });
  });
});
