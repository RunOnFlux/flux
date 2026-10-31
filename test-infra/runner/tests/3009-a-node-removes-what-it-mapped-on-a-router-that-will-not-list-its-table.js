// weight: light
/*
 * A node removes the mappings it made and no longer needs, at its next start, on a router that
 * will not list its table.
 *
 * The node maps its core ports on api port 16137, then restarts on 16147: the four mappings of
 * 16137 are no longer anything's. Its router answers every GetGenericPortMappingEntry with 602,
 * as a router that will not list its table does, so a cleanup that finds stale mappings by
 * listing the table finds none. The node removes them by their ports, from its record of what it
 * mapped.
 *
 * The cleanup runs once per start, once the node's database is ready, in the node's slot of
 * config.upnp.cleanupCycleMs (60s in the harness). The database is ready once the node has peered
 * and synced its apps, so the node is one of a peered fleet: the middle of three.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { enableUpnpGateway, setUpnpListFault, upnpGatewayState } from '../framework/external-http-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

const OLD_API_PORT = 16137;
const NEW_API_PORT = 16147;
const corePorts = (api) => [api - 1, api, api + 1, api + 2];
const NOT_LISTED = 602;
const SUBJECT = 1;

describe('a node removes what it mapped on a router that will not list its table', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;
  let restartedAt;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } } });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    nodeIp = subnet.nodeIp(SUBJECT + 1);
    const client = env.clients[SUBJECT];
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(client.container, OLD_API_PORT);
    const mark = client.getLastEventId();
    await restartFluxos(client.container, { apiPort: OLD_API_PORT });
    await client.followTo(nodeIp, OLD_API_PORT);
    await waitFor(async () => {
      const { mappings } = await upnpGatewayState(nodeIp);
      return corePorts(OLD_API_PORT).every((port) => mappings.some((m) => m.externalPort === port));
    }, { timeout: 150000, interval: 1000, label: `the core ports of ${OLD_API_PORT} mapped` });
    // mapped before the database was connected, and recorded once it was: the boot settles after
    await waitForBootSettled(client, 150000, { afterId: mark });

    await setUpnpListFault(nodeIp, NOT_LISTED);
    restartedAt = Date.now();
    await setNodeApiPort(client.container, NEW_API_PORT);
    await restartFluxos(client.container, { apiPort: NEW_API_PORT });
    await client.followTo(nodeIp, NEW_API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('removes the core mappings of the api port it left, by their ports', async function () {
    this.timeout(240000);
    const oldPorts = corePorts(OLD_API_PORT);
    let state = { mappings: [], requests: [] };
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      return oldPorts.every((port) => !state.mappings.some((m) => m.externalPort === port));
    }, { timeout: 200000, interval: 1000, label: `the core mappings of ${OLD_API_PORT} removed` }).catch(() => {});

    const since = state.requests.filter((r) => Date.parse(r.at) >= restartedAt);
    // canary: the node verified UPnP on its new port, so its start's cleanup could run
    expect(corePorts(NEW_API_PORT).every((port) => state.mappings.some((m) => m.externalPort === port)),
      `verified: the core ports of ${NEW_API_PORT} mapped ${JSON.stringify(state.mappings.map((m) => m.externalPort))}`).to.equal(true);
    expect(since.filter((r) => r.action === 'GetGenericPortMappingEntry' && !r.refused),
      'the router listed no entry').to.deep.equal([]);
    expect(oldPorts.filter((port) => state.mappings.some((m) => m.externalPort === port)),
      `the core mappings of ${OLD_API_PORT} still held`).to.deep.equal([]);
    const removals = since.filter((r) => r.action === 'DeletePortMapping').map((r) => r.port);
    expect(oldPorts.every((port) => removals.includes(port)), `removed by port: ${JSON.stringify(removals)}`).to.equal(true);
  });
});
