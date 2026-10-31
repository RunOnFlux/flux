// weight: heavy
/*
 * An availability test leaves a port an install maps while the test holds it to the install.
 *
 * The node's availability test is pinned to one port (fluxapps.portMin/portMax). A pass listens
 * on it, finds nothing of the node's on it, and is held before it asks the router to map it. An
 * app with that port is installed and held once its port is mapped, before its container: the
 * install holds the port on the router. The test is let go: it asks the router nothing for the
 * port, and its release leaves the install's mapping. The install is let go once the test has
 * stopped listening, and the app runs on its mapping.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

const NODE = 1;
// below the allocator's range, which buildSeedableApp keeps for itself
const PORT = 31150;
const LISTEN_PORT = 8080;
const TEST_BEFORE_MAPPING = 'availability:beforeTestMapping';
const INSTALL_AFTER_PORTS = 'install:afterPorts';
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: 30000, error: 5000, failure: 1000, dos: 300000, appError: 5000,
  },
  thresholds: { dos: 100, portsHighEdge: 3, portsLowEdge: 1 },
};

describe('an availability test leaves a port an install maps to the install', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let node;
  let nodeIp;
  const appName = `e2eupnpavail${Date.now()}`;
  const description = `Flux_App_${appName}`;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
      nodeConfigOverrides: { [NODE]: { fluxapps: { portMin: PORT, portMax: PORT + 1, appsPortCheck: APPS_PORT_CHECK } } },
    });
    node = env.clients[NODE];
    nodeIp = subnet.nodeIp(NODE + 1);
    // the first boot writes userconfig.js (its identity); a node with an api port
    // in it verifies UPnP when it starts
    await waitForBootSettled(node);
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(node.container, 16127);
    await restartFluxos(node.container);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushBusybox('e2eupnpavail', 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    const { requests } = await upnpGatewayState(nodeIp);
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.description === 'Flux_UPNP_Mapping_Test'), 'canary: the node verified UPnP on its gateway').to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks the router nothing for the port, leaves the install\'s mapping, and the app runs on it', async function () {
    this.timeout(600000);
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'maps the availability test\'s port',
        repotag: `${REGISTRY_REPO_HOST}/e2eupnpavail:v1`,
        ports: [PORT],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [LISTEN_PORT],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    const testHeldFrom = node.getLastEventId();
    const heldAt = Date.now();
    await node.holdCheckpoint(TEST_BEFORE_MAPPING, String(PORT));
    let installing;
    try {
      await node.waitForEvent('checkpoint:held', (d) => d.name === TEST_BEFORE_MAPPING && d.key === String(PORT), 240000, { afterId: testHeldFrom });

      const installHeldFrom = node.getLastEventId();
      await node.holdCheckpoint(INSTALL_AFTER_PORTS, appName);
      try {
        installing = installOnNodes(env, app, [NODE], { timeout: 300000 });
        installing.catch(() => {});
        await node.waitForEvent('checkpoint:held', (d) => d.name === INSTALL_AFTER_PORTS && d.key === appName, 240000, { afterId: installHeldFrom });
        const mapped = (await upnpGatewayState(nodeIp)).mappings.filter((m) => m.externalPort === PORT);
        expect(mapped.map((m) => m.description), 'canary: the install mapped the port').to.include(description);

        const testFrom = node.getLastEventId();
        await node.releaseCheckpoint(TEST_BEFORE_MAPPING, String(PORT));
        const outcome = await node.waitForEvent('availability:testMapping', (d) => d.port === PORT, 120000, { afterId: testFrom });
        expect(outcome.data, 'the test\'s map of the install\'s port').to.deep.include({ mapped: false, reason: `${PORT} held by an installation` });
      } finally {
        await node.releaseCheckpoint(INSTALL_AFTER_PORTS, appName);
      }
    } finally {
      await node.releaseCheckpoint(TEST_BEFORE_MAPPING, String(PORT));
    }
    await installing;

    const { mappings, requests } = await upnpGatewayState(nodeIp);
    const ofPort = requests.filter((r) => r.port === PORT && Date.parse(r.at) >= heldAt);
    expect(ofPort.filter((r) => r.action === 'AddPortMapping' && r.description === 'Flux_Test_App'), 'the test\'s add of the port').to.deep.equal([]);
    expect(ofPort.filter((r) => r.action === 'DeletePortMapping'), 'a removal of the port').to.deep.equal([]);
    expect(mappings.filter((m) => m.externalPort === PORT).map((m) => m.description).sort(), 'the port mapped for the app').to.deep.equal([description, description]);
  });
});
