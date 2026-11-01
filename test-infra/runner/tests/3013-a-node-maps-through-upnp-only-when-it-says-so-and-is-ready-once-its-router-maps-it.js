// weight: light
/*
 * A node maps through UPnP only when it says so, and a UPnP node is ready once its router has
 * taken its own ports.
 *
 * A node on an api port other than the default maps through UPnP: only a UPnP node can take
 * one. On the default port, `upnp` in userconfig.js is read as declared. Where it is missing,
 * the node writes it at its start from its network settings: an api port other than the
 * default, or a router address, means UPnP. A node on the default port that says no maps
 * nothing of its own, whatever router it is behind.
 *
 * A UPnP node whose router has not taken its own ports asks again until it does, and its boot
 * waits for them within the deadline it gives its database (system.bootSyncTimeoutMs, 30 s in
 * the harness). Past it, the node is held out of service as upnpRouter and removes its apps; the
 * router taking its ports ends the hold. A router that answers and refuses one of them - another
 * machine holds the node's api port - and a router with UPnP off are each held.
 *
 * The boot reaches its apps once the node's database is ready, so the node is one of a peered
 * fleet: the middle of three.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  crashFluxos, execInContainer, releaseFluxos, setNodeApiPort,
} from '../framework/container.js';
import { giveNodeApiPort, listNodeAtApiPort } from '../framework/node-address.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { disableUpnpGateway, enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForAppInstalled, waitForAppRemoved } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

const SUBJECT = 1;
const API_PORT = 16137;
const LISTEN_PORT = 8080;
const USERCONFIG = '/flux/config/userconfig.js';
const HELD = /UPnP: the router has not taken this node's ports/;

describe('a node maps through UPnP only when it says so, and is ready once its router maps it', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  let nodeIp;
  let otherMachine;
  const appName = `e2eupnpready${Date.now()}`;

  const upnpLine = async () => {
    const { stdout } = await execInContainer(client.container, `grep -E '^ *upnp:' ${USERCONFIG} || true`);
    return stdout.trim();
  };
  // userconfig.js with no upnp key and the api port given, as a config written before the key
  const forgetUpnp = async (apiPort) => {
    await setNodeApiPort(client.container, apiPort);
    const r = await execInContainer(client.container, `sed -i -E '/^ *upnp:/d' ${USERCONFIG}`);
    if (r.exitCode !== 0) throw new Error(`could not remove upnp: ${r.output}`);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } } });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    client = env.clients[SUBJECT];
    nodeIp = subnet.nodeIp(SUBJECT + 1);
    otherMachine = nodeIp.replace(/\.\d+$/, '.240');
    await enableUpnpGateway(nodeIp);
    await giveNodeApiPort(env, SUBJECT, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('writes upnp from its api port where userconfig.js says nothing of it', async function () {
    this.timeout(300000);
    await crashFluxos(client.container, { hold: true });
    await forgetUpnp(API_PORT);
    expect(await upnpLine(), 'canary: no upnp before the start').to.equal('');
    await releaseFluxos(client.container, { apiPort: API_PORT });
    await waitFor(async () => (await upnpLine()) !== '', { timeout: 60000, interval: 1000, label: 'upnp written' });
    expect(await upnpLine(), `api port ${API_PORT}`).to.equal('upnp: true,');

    await crashFluxos(client.container, { hold: true });
    await forgetUpnp(16127);
    await listNodeAtApiPort(client, 16127);
    await releaseFluxos(client.container, { apiPort: 16127 });
    await client.followTo(nodeIp, 16127);
    await waitFor(async () => (await upnpLine()) !== '', { timeout: 60000, interval: 1000, label: 'upnp written' });
    expect(await upnpLine(), 'the default api port and no router address').to.equal('upnp: false,');

    // back as a UPnP node for what follows
    await crashFluxos(client.container, { hold: true });
    await setNodeApiPort(client.container, API_PORT);
    await listNodeAtApiPort(client, API_PORT);
    await releaseFluxos(client.container, { apiPort: API_PORT });
    await client.followTo(nodeIp, API_PORT);
  });

  it('maps nothing of its own on the default api port when it says it does not map through UPnP, behind a router that answers', async function () {
    this.timeout(300000);
    await crashFluxos(client.container, { hold: true });
    await setNodeApiPort(client.container, 16127, { upnp: false });
    await listNodeAtApiPort(client, 16127);
    await enableUpnpGateway(nodeIp);
    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: 16127 });
    await client.followTo(nodeIp, 16127);
    // a start's verification comes before the api listens; a refresh cycle after it
    await new Promise((resolve) => { setTimeout(resolve, 45000); });

    const { requests } = await upnpGatewayState(nodeIp);
    expect(requests.filter((r) => Date.parse(r.at) >= fromMs).map((r) => r.action), 'requests to the router').to.deep.equal([]);

    await crashFluxos(client.container, { hold: true });
    await setNodeApiPort(client.container, API_PORT);
    await listNodeAtApiPort(client, API_PORT);
    await releaseFluxos(client.container, { apiPort: API_PORT });
    await client.followTo(nodeIp, API_PORT);
  });

  // The node started again behind `router`; resolves once it is held as upnpRouter
  const startHeld = async (router) => {
    await crashFluxos(client.container, { hold: true });
    await router();
    const mark = client.getLastEventId();
    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: API_PORT });
    await client.waitForEvent('dos:changed', (d) => HELD.test(String(d.dosMessage)), 240000, { afterId: mark });
    expect((await client.getDOSState()).data.dosState, 'out of service').to.be.at.least(100);
    return { mark, fromMs };
  };
  // The router back with an empty table; resolves once the hold has ended
  const routerTakesItsPorts = async () => {
    const mark = client.getLastEventId();
    await enableUpnpGateway(nodeIp);
    await client.waitForEvent('dos:changed', (d) => !HELD.test(String(d.dosMessage)), 120000, { afterId: mark });
    const { mappings } = await upnpGatewayState(nodeIp);
    expect(mappings.some((m) => m.externalPort === API_PORT && m.internalClient !== otherMachine), 'its own api port mapped once the router took it').to.equal(true);
    expect(String((await client.getDOSState()).data.dosMessage ?? ''), 'the hold ended').to.not.match(HELD);
  };

  it('is held out of service as upnpRouter, and gives up its apps, when its router refuses its ports past its boot\'s deadline, until the router takes them', async function () {
    this.timeout(600000);
    await pushBusybox('e2eupnpready', 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'an app the node gives up',
        repotag: `${REGISTRY_REPO_HOST}/e2eupnpready:v1`,
        ports: [],
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
    const installMark = client.getLastEventId();
    await seedSpawnerApp(env, app, [SUBJECT]);
    await waitForAppInstalled(client, appName, 240000, { afterId: installMark });

    // another machine behind the same router holds the node's api port
    const { mark, fromMs } = await startHeld(() => enableUpnpGateway(nodeIp, {
      mappings: [{
        externalPort: API_PORT, protocol: 'TCP', internalPort: API_PORT, internalClient: otherMachine, description: 'Flux_Backend_API', leaseDuration: 0,
      }],
    }));
    await waitForAppRemoved(client, appName, 240000, { afterId: mark });
    const verification = await client.waitForEvent('upnp:verified', () => true, 1000, { afterId: mark });
    expect(verification.data.verified, 'canary: the router answered its verification').to.equal(true);
    const { requests } = await upnpGatewayState(nodeIp);
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.port === API_PORT && r.refused === 718 && Date.parse(r.at) >= fromMs), 'canary: the router refused its api port').to.equal(true);

    await routerTakesItsPorts();
  });

  it('is held out of service as upnpRouter when its router has UPnP off past its boot\'s deadline, until the router takes its ports', async function () {
    this.timeout(600000);
    const { mark } = await startHeld(() => disableUpnpGateway(nodeIp));
    const verification = await client.waitForEvent('upnp:verified', () => true, 1000, { afterId: mark });
    expect(verification.data.verified, 'canary: the router did not answer its verification').to.equal(false);

    await routerTakesItsPorts();
  });
});
