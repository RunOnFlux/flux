// weight: heavy
/*
 * Where flux-upnpd maps a node's ports, FluxOS asks it for everything and the router for nothing:
 * an install maps its port through flux-upnpd and is aborted when flux-upnpd cannot map it; the
 * availability check maps its test port through it; flux-upnpd is given every port the node
 * wants, again whenever it restarts, and only once boot has declared the installed apps; and an
 * app whose port flux-upnpd has reported failing for upnp.failingAppRemovalMs is removed.
 *
 * Every node runs the flux-upnpd stand-in (test-infra/upnpd-stub), eight behind one router as
 * production runs them. It maps every port it is asked for unless the suite makes one fail, and
 * keeps every set and map FluxOS sent it in order: its account is what the tests read. The node
 * under test is in the middle of the ring.
 *
 * The removal window is compressed to 30 s; its timing is the unit suite's (portManager). The
 * stand-in reports a failure at once where flux-upnpd asks the router first; flux-upnpd's own
 * tests cover that.
 */
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { restartFluxos } from '../framework/container.js';
import {
  failUpnpdMapping, restartUpnpd, upnpdState,
} from '../framework/upnpd-control.js';
import {
  waitFor, waitForAppInstalled, waitForAppRemoved, waitForBootSettled,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const subnet = getSubnetConfig();
const NODES = 8;
const SUBJECT = 3;
const subjectIp = subnet.nodeIp(SUBJECT + 1);
const socketAddressOf = (index) => `${subnet.nodeIp(index + 1)}:16127`;
const FAILING_REMOVAL_MS = 30000;

const appPinnedTo = (name, index) => buildSeedableApp({
  name,
  instances: 1,
  nodes: [socketAddressOf(index)],
  compose: [{
    name,
    description: 'one port, mapped through flux-upnpd',
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

const holds = (set, port) => set.ports.some((entry) => entry.port === port);

describe('flux-upnpd maps what a node wants, and the node removes an app whose port keeps failing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  const name = `e2eupnpd${Date.now()}`;
  let port;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      upnpdNodes: [...Array(NODES).keys()],
      configOverrides: {
        fluxapps: { portTestMaxAttempts: 3 },
        upnp: { failingAppRemovalMs: FAILING_REMOVAL_MS },
      },
    });
    await bootAndPeer(env);
    client = env.clients[SUBJECT];
    const state = await upnpdState(subjectIp);
    expect(state.streams, 'FluxOS follows its flux-upnpd').to.equal(1);
    expect(state.desired.length, 'boot gave flux-upnpd its set').to.be.at.least(1);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('maps an installing app\'s port through flux-upnpd, in both protocols, under the app\'s name', async function () {
    this.timeout(720000);
    await pushImage(name, 'v1');
    const app = await appPinnedTo(name, SUBJECT);
    [port] = app.spec.compose[0].ports;
    const mark = client.getLastEventId();

    await seedSpawnerApp(env, app);
    await waitForAppInstalled(client, name, 600000, { afterId: mark });

    const { maps, desired } = await upnpdState(subjectIp);
    const mapsOfPort = maps.filter((map) => map.port === port);
    expect(mapsOfPort.length, JSON.stringify(maps)).to.be.at.least(1);
    mapsOfPort.forEach((map) => expect(map).to.include({ description: `Flux_App_${name}` }));
    expect(mapsOfPort.at(-1).protocols).to.deep.equal(['tcp', 'udp']);
    const last = desired.at(-1);
    expect(!last || last.at < mapsOfPort.at(-1).at || holds(last, port), 'no set sent since the install lacks its port').to.equal(true);
  });

  it('maps the availability check\'s test port through flux-upnpd, and lets it go after the test', async function () {
    this.timeout(600000);
    // The check's first pass comes as the node starts, so its test mapping is any since boot: the
    // fleet is this suite's own.
    const tested = await client.waitForEvent('availability:testMapping', () => true, 540000);
    const testPort = tested.data.port;

    await waitFor(async () => {
      const { maps, desired } = await upnpdState(subjectIp);
      const map = maps.find((entry) => entry.port === testPort && entry.description === 'Flux_Test_App');
      expect(map, `the test port's map: ${JSON.stringify(maps.slice(-5))}`).to.not.equal(undefined);
      const after = desired.filter((set) => set.at > map.at);
      expect(after.some((set) => !holds(set, testPort)), 'a set without the test port').to.equal(true);
      return true;
    }, { timeout: 120000, interval: 2000, label: `test port ${testPort} mapped through flux-upnpd and let go` });
  });

  it('gives flux-upnpd every port the node wants again when it restarts', async function () {
    this.timeout(180000);
    const before = await upnpdState(subjectIp);

    await restartUpnpd(subjectIp);

    await waitFor(async () => {
      const state = await upnpdState(subjectIp);
      expect(state.restarts).to.equal(before.restarts + 1);
      const sent = state.desired.slice(before.desired.length);
      expect(sent.length, 'a set sent since the restart').to.be.at.least(1);
      expect(holds(sent.at(-1), port), JSON.stringify(sent.at(-1))).to.equal(true);
      expect(state.streams).to.equal(1);
      return true;
    }, { timeout: 120000, interval: 1000, label: 'the set given to the restarted flux-upnpd' });
  });

  it('gives flux-upnpd its set only once boot has declared the installed apps', async function () {
    this.timeout(300000);
    const before = await upnpdState(subjectIp);
    const mark = client.getLastEventId();

    await restartFluxos(client.container);
    await waitForBootSettled(client, 240000, { afterId: mark });

    await waitFor(async () => {
      const { desired } = await upnpdState(subjectIp);
      expect(desired.length, 'a set sent since FluxOS restarted').to.be.above(before.desired.length);
      return true;
    }, { timeout: 60000, interval: 1000, label: 'a set from the restarted FluxOS' });
    const { desired } = await upnpdState(subjectIp);
    const sent = desired.slice(before.desired.length);
    sent.forEach((set) => expect(holds(set, port), `every set holds the installed app's port: ${JSON.stringify(set)}`).to.equal(true));
  });

  it('aborts an install whose port flux-upnpd cannot map, and lets the port go', async function () {
    this.timeout(720000);
    const failing = `e2eupnpdfail${Date.now()}`;
    await pushImage(failing, 'v1');
    const app = await appPinnedTo(failing, SUBJECT);
    const [failingPort] = app.spec.compose[0].ports;
    await failUpnpdMapping(subjectIp, {
      port: failingPort, protocol: 'udp', failure: 'refused', reason: 'ConflictInMappingEntry',
    });
    const mark = client.getLastEventId();

    await seedSpawnerApp(env, app);
    // the port test before the install maps the port through flux-upnpd, and is refused
    await client.waitForEvent('spawner:deferred', (d) => d.appName === failing && d.reason === 'ports_not_available', 600000, { afterId: mark });

    const { maps } = await upnpdState(subjectIp);
    expect(maps.some((map) => map.port === failingPort), 'the port was asked of flux-upnpd').to.equal(true);
    await waitFor(async () => {
      const { desired } = await upnpdState(subjectIp);
      expect(holds(desired.at(-1), failingPort), JSON.stringify(desired.at(-1))).to.equal(false);
      return true;
    }, { timeout: 120000, interval: 2000, label: `port ${failingPort} let go` });
    const installed = await client.get(`/apps/installedapps?_=${Date.now()}`);
    expect((installed.data ?? []).map((entry) => entry.name)).to.not.include(failing);
  });

  it('removes an app once flux-upnpd has reported its port failing for the removal window', async function () {
    this.timeout(300000);
    const mark = client.getLastEventId();
    const failedAt = Date.now();

    await failUpnpdMapping(subjectIp, {
      port, protocol: 'tcp', failure: 'held', holder: subnet.nodeIp(SUBJECT + 1).replace(/\.\d+$/, '.240'),
    });

    const removed = await client.waitForEvent('upnp:failingAppRemoved', (d) => d.app === name, 240000, { afterId: mark });
    expect(Date.now() - failedAt, 'not before the window').to.be.at.least(FAILING_REMOVAL_MS);
    expect(removed.data).to.include({ port, protocol: 'tcp', failure: 'held' });
    await waitForAppRemoved(client, name, 240000, { afterId: mark });
  });
});
