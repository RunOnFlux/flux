// weight: light
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node on any api port but 16127 runs only if it verifies UPnP, and it verifies by mapping
// a test port. Its router's table is full: the test mappings earlier runs of FluxOS left on
// it, and one mapping of another machine on the network. Until UPnP is verified the stale
// mapping cleanup never runs, so the verification itself makes room: it removes this node's
// left-over test mappings, maps its test port, and the node maps its own ports in the room
// that leaves. The other machine's mapping is not this node's to remove.

const API_PORT = 16137;
// The node maps no other address: upnp.nodeIp is empty in the harness, so its mappings
// point at the address the client is given in its place.
const NODE_CLIENT = '127.0.0.1';
const OTHER_MACHINE = subnet.nodeIp(9);

const mapping = (externalPort, description, internalClient = NODE_CLIENT) => ({
  externalPort, protocol: 'TCP', internalPort: externalPort, internalClient, description, leaseDuration: 0,
});
const LEFT_OVER = [
  mapping(31000, 'Flux_Test_App'),
  mapping(31001, 'Flux_Prelaunch_App_31001'),
  mapping(31002, 'Flux_Test_App'),
  mapping(31003, 'Flux_UPNP_Mapping_Test'),
];
const OTHERS = mapping(32000, 'Flux_App_sibling', OTHER_MACHINE);
// Full as it starts, and room for the node's four ports once the left-overs are gone.
const CAPACITY = LEFT_OVER.length + 1;
if (CAPACITY - 1 < 4) throw new Error('3001: the table must have room for the four core ports once cleared');

describe('a node behind a full router table verifies UPnP', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;

  before(async function () {
    this.timeout(240000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    nodeIp = subnet.nodeIp(1);
    // the first boot writes userconfig.js (its identity) and would put back the old port
    await waitForBootSettled(env.clients[0]);
    await enableUpnpGateway(nodeIp, { capacity: CAPACITY, mappings: [...LEFT_OVER, OTHERS] });
    await setNodeApiPort(env.clients[0].container, API_PORT);
    await restartFluxos(env.clients[0].container, { apiPort: API_PORT });
    await env.clients[0].followTo(nodeIp, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('removes its left-over test mappings and maps its own ports in their room', async function () {
    this.timeout(180000);
    const corePorts = [API_PORT - 1, API_PORT, API_PORT + 1, API_PORT + 2];
    let table = [];
    await waitFor(async () => {
      table = (await upnpGatewayState(nodeIp)).mappings;
      return corePorts.every((port) => table.some((m) => m.externalPort === port));
    }, { timeout: 150000, interval: 2000, label: 'the node\'s own ports mapped' }).catch(() => {});

    expect(table.map((m) => m.externalPort).sort(), 'the router\'s table').to.deep.equal([...corePorts, OTHERS.externalPort].sort());
  });

  it('leaves the other machine\'s mapping as it was', async function () {
    const { mappings, requests } = await upnpGatewayState(nodeIp);

    expect(requests.some((r) => r.action === 'GetGenericPortMappingEntry'), 'canary: the node listed the table').to.equal(true);
    expect(mappings.find((m) => m.externalPort === OTHERS.externalPort)).to.deep.equal(OTHERS);
  });
});

// The same full table on a router that stores descriptions as a FRITZ!Box does, its
// underscores and spaces as dots: the left-over test mappings read 'Flux.Test.App' and the
// like, and are this node's all the same.
describe('a node behind a full FRITZ!Box-style router table verifies UPnP', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;
  const fritz = (m) => ({ ...m, description: m.description.replace(/_/g, '.') });

  before(async function () {
    this.timeout(240000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    nodeIp = subnet.nodeIp(1);
    // the first boot writes userconfig.js (its identity) and would put back the old port
    await waitForBootSettled(env.clients[0]);
    await enableUpnpGateway(nodeIp, {
      capacity: CAPACITY, mappings: [...LEFT_OVER.map(fritz), fritz(OTHERS)], fritzDescriptions: true,
    });
    await setNodeApiPort(env.clients[0].container, API_PORT);
    await restartFluxos(env.clients[0].container, { apiPort: API_PORT });
    await env.clients[0].followTo(nodeIp, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('removes its left-over test mappings and maps its own ports in their room', async function () {
    this.timeout(180000);
    const corePorts = [API_PORT - 1, API_PORT, API_PORT + 1, API_PORT + 2];
    let table = [];
    await waitFor(async () => {
      table = (await upnpGatewayState(nodeIp)).mappings;
      return corePorts.every((port) => table.some((m) => m.externalPort === port));
    }, { timeout: 150000, interval: 2000, label: 'the node\'s own ports mapped' }).catch(() => {});

    expect(table.map((m) => m.externalPort).sort(), 'the router\'s table').to.deep.equal([...corePorts, OTHERS.externalPort].sort());
    expect(table.find((m) => m.externalPort === API_PORT).description, 'canary: the router stores dots').to.equal('Flux.Backend.API');
  });
});

// The same router with nothing of this node's to remove: it holds the node's own four ports,
// mapped by an earlier run, and other machines' mappings up to its capacity. The test mapping
// finds no room, and the router already maps this node's api port to it, so the node runs on
// what it holds.
describe('a node whose own ports fill its router\'s table verifies UPnP', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;
  const OWN = [API_PORT - 1, API_PORT, API_PORT + 1, API_PORT + 2]
    .map((port, i) => mapping(port, ['Flux_Home_UI', 'Flux_Backend_API', 'Flux_Backend_API_SSL', 'Flux_Syncthing'][i]));
  const OTHER_MACHINES = [32000, 32001].map((port) => mapping(port, 'Flux_App_sibling', OTHER_MACHINE));
  const FULL = [...OWN, ...OTHER_MACHINES];

  before(async function () {
    this.timeout(240000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    nodeIp = subnet.nodeIp(1);
    // the first boot writes userconfig.js (its identity) and would put back the old port
    await waitForBootSettled(env.clients[0]);
    await enableUpnpGateway(nodeIp, { capacity: FULL.length, mappings: FULL });
    await setNodeApiPort(env.clients[0].container, API_PORT);
    await restartFluxos(env.clients[0].container, { apiPort: API_PORT });
    await env.clients[0].followTo(nodeIp, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('starts on its api port, its mappings and the other machines\' as they were', async function () {
    this.timeout(180000);
    // past the 120s a node that failed verification waits before it exits
    await new Promise((resolve) => { setTimeout(resolve, 150000); });
    const { mappings, requests } = await upnpGatewayState(nodeIp);

    expect(requests.some((r) => r.action === 'AddPortMapping' && r.port === API_PORT + 3), 'canary: the node asked for its test mapping').to.equal(true);
    // a node that failed verification never maps its own ports
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.port === API_PORT), 'the node mapped its api port').to.equal(true);
    expect(mappings.map((m) => m.externalPort).sort()).to.deep.equal(FULL.map((m) => m.externalPort).sort());
    expect(requests.filter((r) => r.action === 'DeletePortMapping'), 'nothing removed').to.deep.equal([]);
  });
});
