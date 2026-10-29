// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { pushBrokenImage, pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { waitFor, waitForAppInstalled, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node behind UPnP proves an app's port as the last check before it installs
// it, mapping the port under the app's own description. The mapping it proved is
// the one the app is installed with: the router is asked to map the port again as
// the app installs, and never to remove it in between. An install that fails
// after the test - here the image pulls and its container cannot start - leaves
// nothing of the port on the router.
//
// The gateway records every request the node sends it in order, so the router's
// own account says whether the port was removed between the test and the install.

const subnet = getSubnetConfig();
const socketAddressOf = (index) => `${subnet.nodeIp(index + 1)}:16127`;

// Enough attempts that the node always reaches a peer that answers.
const PORT_TEST = { portTestMaxAttempts: 3 };

// The harness allocates the app's port; the test reads it from the spec.
const appPinnedTo = (name, index) => buildSeedableApp({
  name,
  instances: 1,
  nodes: [socketAddressOf(index)],
  compose: [{
    name,
    description: 'one port, proven before install',
    repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
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

// What the node asked of the router for one port, in order.
const requestsFor = async (ip, port) => {
  const gateway = await upnpGatewayState(ip);
  return gateway.requests
    .filter((request) => request.port === port && ['AddPortMapping', 'DeletePortMapping'].includes(request.action))
    .map((request) => `${request.action} ${request.protocol} ${request.description ?? ''}`.trim());
};

const mappedProtocols = async (ip, port) => {
  const gateway = await upnpGatewayState(ip);
  return gateway.mappings.filter((mapping) => mapping.externalPort === port).map((mapping) => mapping.protocol).sort();
};

describe('a port the install test proves stays mapped for the install', function () {
  const SUBJECT = 1;
  const subjectIp = subnet.nodeIp(SUBJECT + 1);
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, ...PORT_TEST } },
    });
    // the first boot writes userconfig.js (its identity); a node with an api port
    // in it verifies UPnP when it starts
    const subject = env.clients[SUBJECT];
    await waitForBootSettled(subject);
    await enableUpnpGateway(subjectIp);
    await setNodeApiPort(subject.container, 16127);
    await restartFluxos(subject.container);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('maps a proven port again as the app installs, and never removes it in between', async function () {
    this.timeout(720000);
    const name = `e2ekeepmap${Date.now()}`;
    const description = `Flux_App_${name}`;
    await pushImage(name, 'v1');
    const app = await appPinnedTo(name, SUBJECT);
    const [port] = app.spec.compose[0].ports;
    const client = env.clients[SUBJECT];
    const mark = client.getLastEventId();

    await seedSpawnerApp(env, app);
    await client.waitForEvent('ports:proven', (d) => d.ports.includes(port), 420000, { afterId: mark });
    await waitForAppInstalled(client, name, 300000, { afterId: mark });

    const requests = await requestsFor(subjectIp, port);
    // the test's map and the install's, each over both protocols
    expect(requests.slice(0, 4), `the router is asked to map the port for the test, then for the install: ${JSON.stringify(requests)}`).to.deep.equal([
      `AddPortMapping TCP ${description}`,
      `AddPortMapping UDP ${description}`,
      `AddPortMapping TCP ${description}`,
      `AddPortMapping UDP ${description}`,
    ]);
    expect(requests.filter((request) => request.startsWith('DeletePortMapping')), `a removal of the proven port: ${JSON.stringify(requests)}`).to.deep.equal([]);
    expect(await mappedProtocols(subjectIp, port)).to.deep.equal(['TCP', 'UDP']);
  });

  it('leaves nothing of a proven port on the router when the install fails', async function () {
    this.timeout(720000);
    const name = `e2ebroken${Date.now()}`;
    const description = `Flux_App_${name}`;
    await pushBrokenImage(name, 'v1');
    const app = await appPinnedTo(name, SUBJECT);
    const [port] = app.spec.compose[0].ports;
    const client = env.clients[SUBJECT];
    const mark = client.getLastEventId();

    await seedSpawnerApp(env, app);
    await client.waitForEvent('ports:proven', (d) => d.ports.includes(port), 420000, { afterId: mark });
    await client.waitForEvent('spawner:installFailed', (d) => d.appName === name, 300000, { afterId: mark });

    await waitFor(async () => (await mappedProtocols(subjectIp, port)).length === 0, {
      timeout: 120000, interval: 2000, label: `port ${port} gone from the router`,
    });
    const requests = await requestsFor(subjectIp, port);
    // the test's map, the install's, and the failed install's removal
    expect(requests, JSON.stringify(requests)).to.deep.equal([
      `AddPortMapping TCP ${description}`,
      `AddPortMapping UDP ${description}`,
      `AddPortMapping TCP ${description}`,
      `AddPortMapping UDP ${description}`,
      'DeletePortMapping TCP',
      'DeletePortMapping UDP',
    ]);
  });
});
