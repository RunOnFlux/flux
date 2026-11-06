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
import { enableUpnpGateway, setUpnpProtocolFault, upnpGatewayState } from '../framework/external-http-control.js';
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
//   udp-replies-lost on a PEER: it never hears a reply to its own probes, so it is
//                    silent about every node. Two such peers do not refuse a node
//                    while a peer that proves its port is still to ask.
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
const UPNP_DOS = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';

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

    // Every peer is silent here, and the node may ask as many as it has
    // attempts. Silence is weighed only once no attempt is left that could prove
    // the port, so the refusal names a peer for every attempt.
    const refused = await client.waitForEvent('ports:udpUnreachable', (d) => d.port === 31142, 420000, { afterId: after });
    expect(refused.data.reason).to.equal('udpUnreachable');
    expect(refused.data.peers, 'refused before every attempt was spent').to.have.length(PORT_TEST.portTestMaxAttempts);
    expect(new Set(refused.data.peers).size).to.equal(PORT_TEST.portTestMaxAttempts);
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

describe('a node whose first peers cannot hear UDP replies', function () {
  const NODE = 0;
  const DEAF = [1, 2];
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      networkShapes: Object.fromEntries(DEAF.map((i) => [i, 'udp-replies-lost'])),
      // every other node is asked, the two deaf ones among them
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, portTestMaxAttempts: 3 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('is proven by the peer that hears it', async function () {
    this.timeout(720000);
    await provenAndInstalled(env, NODE, 'udpdeafpeersapp', 31146);
  });
});

// A node behind UPnP maps one protocol a pass, TCP and UDP in turn, so a pass
// costs its router one mapping and one removal. A router refusing the UDP
// mapping is as broken as one refusing TCP.
describe('a node behind UPnP tests one protocol a pass', function () {
  const NODE = 0;
  let env;
  let nodeIp;
  dumpLogsOnFailure(() => env);
  const testMappings = (requests) => requests.filter((r) => r.action === 'AddPortMapping' && r.description === 'Flux_Test_App');

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, ...PORT_TEST } },
      // a passing test is followed by the next pass 20 s later, and a router fault
      // reaches the DOS on its second count
      nodeConfigOverrides: {
        [NODE]: {
          fluxapps: {
            appsPortCheck: {
              timeoutsMs: {
                default: 20000, error: 2000, failure: 1000, dos: 5 * 60 * 1000, appError: 5000,
              },
              thresholds: { dos: 8, portsHighEdge: 3, portsLowEdge: 1 },
            },
          },
        },
      },
    });
    nodeIp = subnet.nodeIp(NODE + 1);
    const node = env.clients[NODE];
    await waitForBootSettled(node);
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(node.container, 16127);
    await restartFluxos(node.container);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('maps TCP and UDP on alternate passes, one mapping a pass, and proves both', async function () {
    this.timeout(600000);
    let made = [];
    await waitFor(async () => {
      made = testMappings((await upnpGatewayState(nodeIp)).requests);
      return made.length >= 3;
    }, { timeout: 480000, interval: 5000, label: 'three passes behind UPnP' });

    const [first, second, third] = made;
    expect([first.protocol, second.protocol, third.protocol]).to.deep.equal(['TCP', 'UDP', 'TCP']);
    expect(new Set([first.port, second.port, third.port]).size, 'one mapping a pass').to.equal(3);
    expect(await udpCheck(env.clients[NODE])).to.equal('ok');
  });

  it('is out of service, mapping UDP and nothing else, once its router refuses UDP mappings', async function () {
    this.timeout(600000);
    await setUpnpProtocolFault(nodeIp, 'UDP', 606);
    const from = Date.now();

    await waitFor(async () => (await env.clients[NODE].getDOSState()).data?.dosMessage === UPNP_DOS, {
      timeout: 480000, interval: 5000, label: 'the node is out of service for its router',
    });

    const refusedSince = testMappings((await upnpGatewayState(nodeIp)).requests).filter((r) => Date.parse(r.at) >= from);
    const lastTcp = refusedSince.findLastIndex((r) => r.protocol === 'TCP');
    const firstRefusal = refusedSince.findIndex((r) => r.refused === 606);
    expect(firstRefusal, 'canary: the router refused a UDP mapping').to.be.at.least(0);
    expect(lastTcp, 'a TCP pass after the router refused UDP').to.be.below(firstRefusal);
    await setUpnpProtocolFault(nodeIp, 'UDP', null);
  });
});

// A pass whose TCP passes clears what the TCP failures before it left, even
// when the first peer hears nothing over UDP and the port is retested over UDP.
describe('a node whose TCP comes back while its UDP is blocked', function () {
  const NODE = 0;
  // A pass after a passing one comes PASS_MS later, so a TCP block is met within
  // one. The waits keep production's order: a failure, an error, an app error and
  // a DOS each retest sooner than a passing pass does.
  const PASS_MS = 30 * 1000;
  const PORT_CHECK = {
    timeoutsMs: {
      default: PASS_MS, error: 5000, failure: 1000, dos: 15000, appError: 10000,
    },
    // failed ports never outnumber the low edge, so a passing pass clears them all
    thresholds: { dos: 100, portsHighEdge: 2, portsLowEdge: 2 },
  };
  // Two passes and the time a pass's peer tests take.
  const PASSES_MS = 2 * PASS_MS + 60 * 1000;
  let env;
  dumpLogsOnFailure(() => env);
  // Inbound TCP connections to the node, bar its FluxOS ports, dropped on its fleet device.
  const tcpBlock = (op) => {
    const ip = subnet.nodeIp(NODE + 1);
    return `dev=$(ip -o -4 addr show | awk -v ip=${ip} '{ split($4, a, "/"); if (a[1] == ip) print $2 }'); `
      + `iptables -w ${op} INPUT -i "$dev" -p tcp -m conntrack --ctstate NEW -m multiport ! --dports 16100:16299 -j DROP`;
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      networkShapes: { [NODE]: 'udp-blocked' },
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1, ...PORT_TEST } },
      nodeConfigOverrides: {
        [NODE]: { fluxapps: { appsPortCheck: PORT_CHECK } },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  // Which branch a pass took is a tally on /flux/testcounters, never a stream.
  it('clears its failed ports on the pass whose TCP passes and whose first peer hears nothing over UDP', async function () {
    this.timeout(2 * PASSES_MS + 60000);
    const client = env.clients[NODE];
    const tally = async (name, ...path) => path.reduce((node, key) => node?.[key], (await client.getTestCounters())[name]) || 0;

    const blocked = await execInContainer(client.container, tcpBlock('-I'));
    expect(blocked.exitCode, blocked.output).to.equal(0);
    const unreachableBefore = await tally('availability:pass', 'unreachable', 'unknown');
    await waitFor(async () => (await tally('availability:pass', 'unreachable', 'unknown')) > unreachableBefore, {
      timeout: PASSES_MS, interval: 2000, label: 'a pass whose TCP test failed',
    });

    // Counted from here: the passes before the block heard nothing over UDP too.
    const clearedBefore = await tally('availability:firstUdpSilence', 'passed', 'cleared');
    const notClearedBefore = await tally('availability:firstUdpSilence', 'passed', 'notCleared');
    const unblocked = await execInContainer(client.container, tcpBlock('-D'));
    expect(unblocked.exitCode, unblocked.output).to.equal(0);
    await waitFor(async () => (await tally('availability:firstUdpSilence', 'passed', 'cleared')) > clearedBefore
      || (await tally('availability:firstUdpSilence', 'passed', 'notCleared')) > notClearedBefore, {
      timeout: PASSES_MS, interval: 2000, label: 'a pass whose TCP passed and whose first peer heard nothing over UDP',
    });

    expect(await tally('availability:firstUdpSilence', 'passed', 'notCleared') - notClearedBefore, 'failed ports left for the retest to clear').to.equal(0);
    expect(await tally('availability:firstUdpSilence', 'passed', 'cleared') - clearedBefore).to.be.at.least(1);
  });
});

describe('a port closed over UDP, under the policy that counts it and turns the install refusal off', function () {
  const BLOCKED = 0;
  // blocked too, on the default thresholds, so it stays in service to install
  const INSTALLS = 1;
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      networkShapes: { [BLOCKED]: 'udp-blocked', [INSTALLS]: 'udp-blocked' },
      policy: { documents: { udpportdos: true, udpinstallrefusaloff: true } },
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

  // The switch that turns the refusal off without a release.
  it('installs on a port two peers hear nothing on over UDP, as udpUnproven', async function () {
    this.timeout(420000);
    const client = env.clients[INSTALLS];
    const after = client.getLastEventId();
    await seedSpawnerApp(env, await appPinnedTo('udprefusaloffapp', 31147, INSTALLS));

    const unproven = await client.waitForEvent('ports:unproven', () => true, 420000, { afterId: after });
    expect(unproven.data.reason).to.equal('udpUnproven');
    expect(unproven.data.peers, 'canary: peers heard nothing over UDP').to.have.length.at.least(2);
    await waitForAppInstalled(client, 'udprefusaloffapp', 300000, { afterId: after });
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
