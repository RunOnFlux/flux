// weight: light
/*
 * A node maps no port of an app removed while its boot maps the installed apps' ports.
 *
 * At boot a node wants every installed app's ports before it reconciles its apps, and maps them
 * afterwards, each only while it is still wanted. A removal in between - the reconcile's, or any
 * other - releases the app's ports, so its mapping is never asked for.
 *
 * The boot's mappings are held after its ports are wanted and before any is mapped
 * (boot:afterPortsDeclared) while the app is removed, once the boot has settled its apps and
 * takes a removal; the router then sees no mapping of the app's port. The node's database must be ready for the boot to reach its apps, so the node is
 * one of a peered fleet: the middle of three.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { giveNodeApiPort } from '../framework/node-address.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForAppInstalled, waitForAppRemoved } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

const SUBJECT = 1;
const API_PORT = 16137;
const LISTEN_PORT = 8080;
const DECLARED = 'boot:afterPortsDeclared';

describe('a node maps no port of an app removed while its boot maps the installed apps\' ports', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  let nodeIp;
  const appName = `e2eupnpbootgone${Date.now()}`;
  let appPort;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } } });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    client = env.clients[SUBJECT];
    nodeIp = subnet.nodeIp(SUBJECT + 1);
    await enableUpnpGateway(nodeIp);
    await giveNodeApiPort(env, SUBJECT, API_PORT);

    await pushBusybox('e2eupnpbootgone', 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'holds a port on the router',
        repotag: `${REGISTRY_REPO_HOST}/e2eupnpbootgone:v1`,
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
    [appPort] = app.spec.compose[0].ports;
    const mark = client.getLastEventId();
    await seedSpawnerApp(env, app, [SUBJECT]);
    await waitForAppInstalled(client, appName, 240000, { afterId: mark });
    await waitFor(async () => (await upnpGatewayState(nodeIp)).mappings.some((m) => m.externalPort === appPort), {
      timeout: 120000, interval: 2000, label: 'canary: the app\'s port mapped while it runs',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks the router for no mapping of the port of an app removed while its boot is held', async function () {
    this.timeout(480000);
    // a session opened now holds across the restart: a node just started is not yet available to log in to
    const auth = await authenticate(client.url, fluxTeamKey());
    await crashFluxos(client.container, { hold: true });
    await enableUpnpGateway(nodeIp);

    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: API_PORT });
    const mark = client.getLastEventId();
    await client.holdCheckpoint(DECLARED, 'boot');
    try {
      await client.waitForEvent('checkpoint:held', (d) => d.name === DECLARED, 240000, { afterId: mark });
      // a removal is taken once the boot has settled its apps; the mappings wait on the hold
      await client.waitForEvent('boot:settled', () => true, 240000, { afterId: mark });
      const res = await fetch(`${client.url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
      expect(res.status, `the removal answered: ${await res.text()}`).to.equal(200);
      await waitForAppRemoved(client, appName, 240000, { afterId: mark });
    } finally {
      await client.releaseCheckpoint(DECLARED, 'boot');
    }

    // the boot's mappings, then a refresh cycle (30 s in the harness)
    await new Promise((resolve) => { setTimeout(resolve, 45000); });
    const state = await upnpGatewayState(nodeIp);
    const since = state.requests.filter((r) => Date.parse(r.at) >= fromMs);
    expect(since.some((r) => r.action === 'AddPortMapping' && r.port === API_PORT), 'canary: the node mapped its own ports again').to.equal(true);
    expect(since.filter((r) => r.action === 'AddPortMapping' && r.port === appPort), 'a mapping of the removed app\'s port').to.deep.equal([]);
    expect(state.mappings.some((m) => m.externalPort === appPort), 'the removed app\'s port on the router').to.equal(false);
  });
});
