// weight: light
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
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
    LEFT_OVER.forEach(({ externalPort, description }) => {
      expect(env.nodeHasLog(0, `UPnP - left-over test mapping removed: TCP ${externalPort} (${description})`), `${externalPort} removed`).to.equal(true);
    });
  });

  it('leaves the other machine\'s mapping as it was', async function () {
    const { mappings, requests } = await upnpGatewayState(nodeIp);

    expect(requests.some((r) => r.action === 'GetGenericPortMappingEntry'), 'canary: the node listed the table').to.equal(true);
    expect(mappings.find((m) => m.externalPort === OTHERS.externalPort)).to.deep.equal(OTHERS);
  });
});
