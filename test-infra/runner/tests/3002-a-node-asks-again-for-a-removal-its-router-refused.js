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

// A node verifies UPnP by mapping a test port, reading it back and removing it. Its router
// refuses the first removals it is asked for. The node verifies all the same - the router
// took the mapping and showed it - and asks again for the removal, waiting longer each
// time (test-infra/config/shared.js: 2s, doubling to 8s), until the router removes it.

const API_PORT = 16137;
const TEST_PORT = API_PORT + 3;
const REFUSED = 2;
const FIRST_RETRY_MS = 2000;

describe('a node asks again for a removal its router refused', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;

  before(async function () {
    this.timeout(240000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    nodeIp = subnet.nodeIp(1);
    // the first boot writes userconfig.js (its identity) and would put back the old port
    await waitForBootSettled(env.clients[0]);
    await enableUpnpGateway(nodeIp, { refuseDeletes: REFUSED });
    await setNodeApiPort(env.clients[0].container, API_PORT);
    await restartFluxos(env.clients[0].container, { apiPort: API_PORT });
    await env.clients[0].followTo(nodeIp, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('verifies, and removes its test mapping once the router takes the removal', async function () {
    this.timeout(180000);
    const corePorts = [API_PORT - 1, API_PORT, API_PORT + 1, API_PORT + 2];
    let state = { mappings: [], requests: [] };
    const removalsOfTestPort = () => state.requests.filter((r) => r.action === 'DeletePortMapping' && r.port === TEST_PORT);
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      return removalsOfTestPort().length > REFUSED
        && corePorts.every((port) => state.mappings.some((m) => m.externalPort === port));
    }, { timeout: 150000, interval: 1000, label: 'the test mapping removed and the core ports mapped' }).catch(() => {});

    const asks = removalsOfTestPort();
    expect(asks.filter((r) => r.refused === 501).length, 'canary: the router refused the first removals').to.equal(REFUSED);
    expect(asks.length, 'asked again until the router took it').to.equal(REFUSED + 1);
    // a node that failed verification never maps its own ports
    expect(corePorts.every((port) => state.mappings.some((m) => m.externalPort === port)), 'verified: its own ports mapped').to.equal(true);
    expect(state.mappings.some((m) => m.externalPort === TEST_PORT), 'the test mapping is gone').to.equal(false);

    const gaps = asks.slice(1).map((r, i) => Date.parse(r.at) - Date.parse(asks[i].at));
    expect(gaps[0], 'the first ask again waits the first retry').to.be.at.least(FIRST_RETRY_MS - 250);
    expect(gaps[1], 'the next waits twice as long').to.be.at.least(2 * FIRST_RETRY_MS - 250);
  });

  it('asks for no other removal of the test port', async function () {
    this.timeout(30000);
    await new Promise((resolve) => { setTimeout(resolve, 10000); });
    const { requests } = await upnpGatewayState(nodeIp);
    expect(requests.filter((r) => r.action === 'DeletePortMapping' && r.port === TEST_PORT).length).to.equal(REFUSED + 1);
  });
});
