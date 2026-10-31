// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import {
  enableUpnpGateway, setUpnpCapacity, setUpnpDeleteFault, setUpnpLookupFault, setUpnpRefuseDeletes,
  upnpGatewayState,
} from '../framework/external-http-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import {
  waitFor, waitForAppInstalled, waitForAppRemoved, waitForBootSettled,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const subnet = getSubnetConfig();

// A node behind UPnP whose router refuses it - to remove a mapping, or to make
// one - is out of service until the router stops. Its availability check waits
// ten minutes after a passing test and five in DOS, so only UPnP reaching it
// can start a pass sooner than that.
//
// An app's removal the router refuses starts the next pass at once; each pass
// while it stays refused makes no test mapping and counts toward the DOS, and
// the router taking the removal starts the pass that tests and releases the
// node. An app's mapping a full router refuses starts the next pass at once;
// that pass's own test mapping is refused too, and so is every one after it
// until the router has room, when the next pass releases the node. A router
// that carries out a removal but answers it with a fault - and answers the
// same for an entry it no longer holds - leaves nothing pending: the retry
// finds the entry gone, and the node stays in service. A lookup the router
// answers with a fault settles nothing: the mapping still counts as the
// node's, the node is out of service while the router refuses to remove it,
// and back once the router has.

const NODE = 0;
const PASSED_WAIT_MS = 10 * 60 * 1000;
const DOS_WAIT_MS = 5 * 60 * 1000;
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: PASSED_WAIT_MS, error: 5000, failure: 1000, dos: DOS_WAIT_MS, appError: 5000,
  },
  thresholds: { dos: 100, portsHighEdge: 3, portsLowEdge: 1 },
};
// 25 counted passes, 5 s apart, reach the threshold of 100
const DOS_WITHIN_MS = 4 * 60 * 1000;
// the harness's longest removal retry (8 s) and one pass
const RELEASED_WITHIN_MS = 90 * 1000;
if (DOS_WITHIN_MS >= PASSED_WAIT_MS || RELEASED_WITHIN_MS >= DOS_WAIT_MS) {
  throw new Error('3003: each budget must end before the wait only a wake can cut short');
}
const UPNP_DOS = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
const LISTEN_PORT = 8080;

const dosOf = async (client) => (await client.getDOSState()).data ?? {};

describe('a node whose router refuses it is out of service until it stops', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let node;
  let nodeIp;
  let appName;
  let appPort;
  const gateway = () => upnpGatewayState(nodeIp);
  const testMappings = (requests, sinceMs = 0) => requests.filter((r) => r.action === 'AddPortMapping'
    && r.description === 'Flux_Test_App' && Date.parse(r.at) >= sinceMs);
  const buildApp = (name) => buildSeedableApp({
    name,
    compose: [{
      name,
      description: 'holds a port on the router',
      repotag: `${REGISTRY_REPO_HOST}/e2eupnprefuse:v1`,
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

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
      nodeConfigOverrides: { [NODE]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } } },
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
    await pushBusybox('e2eupnprefuse', 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });

    const { requests } = await gateway();
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.description === 'Flux_UPNP_Mapping_Test'), 'canary: the node verified UPnP on its gateway').to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('tests its port over one protocol a pass, TCP first, and waits the long wait after a test that passed', async function () {
    this.timeout(300000);
    let state = { requests: [] };
    await waitFor(async () => {
      state = await gateway();
      const [first] = testMappings(state.requests);
      return Boolean(first) && state.requests.some((r) => r.action === 'DeletePortMapping'
        && r.port === first.port && Date.parse(r.at) >= Date.parse(first.at));
    }, { timeout: 240000, interval: 2000, label: 'a test mapping made and removed' });

    const made = testMappings(state.requests);
    const [first] = made;
    expect(made.filter((r) => r.port === first.port).map((r) => r.protocol), 'one protocol, TCP')
      .to.deep.equal(['TCP']);

    // a failed test is retried within seconds; a passed one only after the long wait
    const quietFrom = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, 30000); });
    expect(testMappings((await gateway()).requests, quietFrom), 'no test mapping in the long wait').to.have.length(0);
    expect((await dosOf(node)).dosMessage ?? null).to.not.equal(UPNP_DOS);
  });

  it('is out of service, with no new test mapping, once its router has refused an app\'s removal for as many passes as the threshold takes', async function () {
    this.timeout(DOS_WITHIN_MS + 400000);
    appName = `e2eupnprefuse${Date.now()}`;
    const app = await buildApp(appName);
    [appPort] = app.spec.compose[0].ports;
    const mark = node.getLastEventId();
    await seedSpawnerApp(env, app, [NODE]);
    await waitForAppInstalled(node, appName, 240000, { afterId: mark });
    expect((await gateway()).mappings.filter((m) => m.externalPort === appPort).map((m) => m.protocol).sort(), 'the app\'s port mapped').to.deep.equal(['TCP', 'UDP']);

    await setUpnpRefuseDeletes(nodeIp, Infinity);
    const refusedFrom = Date.now();
    const auth = await authenticate(node.url, fluxTeamKey());
    const res = await fetch(`${node.url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(node, appName, 120000);

    await waitFor(async () => (await dosOf(node)).dosMessage === UPNP_DOS, {
      timeout: DOS_WITHIN_MS, interval: 2000, label: 'the node out of service for its router',
    });

    const { requests, mappings } = await gateway();
    const refusedRemovals = requests.filter((r) => r.action === 'DeletePortMapping' && r.port === appPort && r.refused === 501);
    expect(refusedRemovals.length, 'canary: the router refused the app\'s removal').to.be.at.least(2);
    expect(mappings.some((m) => m.externalPort === appPort), 'the app\'s mapping still on the router').to.equal(true);
    expect(testMappings(requests, refusedFrom), 'no test mapping while a removal is refused').to.have.length(0);
  });

  it('is back in service soon after its router removes the mapping, sooner than its wait in DOS', async function () {
    this.timeout(RELEASED_WITHIN_MS + 60000);
    const takenFrom = Date.now();
    await setUpnpRefuseDeletes(nodeIp, 0);

    await waitFor(async () => (await dosOf(node)).dosMessage !== UPNP_DOS, {
      timeout: RELEASED_WITHIN_MS, interval: 2000, label: 'the node back in service',
    });

    const { requests, mappings } = await gateway();
    expect(mappings.some((m) => m.externalPort === appPort), 'the app\'s mapping removed').to.equal(false);
    expect(testMappings(requests, takenFrom).length, 'a test ran once the router took the removal').to.be.at.least(1);
  });

  it('is out of service once a full router refuses an app\'s mapping, sooner than its wait after a passing test', async function () {
    this.timeout(DOS_WITHIN_MS + 400000);
    // the pass that released the node passed its test: the check is in its wait after one
    await waitFor(async () => (await dosOf(node)).dosMessage !== UPNP_DOS, { timeout: 30000, interval: 2000 });
    const { mappings } = await gateway();
    await setUpnpCapacity(nodeIp, mappings.length);
    const fullFrom = Date.now();
    const name = `e2eupnpfull${Date.now()}`;
    const app = await buildApp(name);
    const [port] = app.spec.compose[0].ports;
    await seedSpawnerApp(env, app, [NODE]);

    await waitFor(async () => (await dosOf(node)).dosMessage === UPNP_DOS, {
      timeout: DOS_WITHIN_MS, interval: 2000, label: 'the node out of service for its full router',
    });

    const { requests } = await gateway();
    const refused = requests.filter((r) => r.action === 'AddPortMapping' && r.refused === 728 && Date.parse(r.at) >= fullFrom);
    expect(refused.some((r) => r.port === port), 'canary: the router refused the app\'s mapping').to.equal(true);
    expect(refused.some((r) => r.description === 'Flux_Test_App'), 'the check\'s own test mapping refused too').to.equal(true);
  });

  it('is back in service at its next pass once the router has room', async function () {
    this.timeout(DOS_WAIT_MS + 120000);
    const roomFrom = Date.now();
    await setUpnpCapacity(nodeIp, null);

    await waitFor(async () => (await dosOf(node)).dosMessage !== UPNP_DOS, {
      timeout: DOS_WAIT_MS + 60000, interval: 2000, label: 'the node back in service',
    });

    const made = testMappings((await gateway()).requests, roomFrom);
    expect(made.some((r) => r.refused === undefined), 'a test mapping the router took').to.equal(true);
  });

  it('stays in service when its router carries out an app\'s removal but answers it with a fault', async function () {
    this.timeout(DOS_WITHIN_MS + 400000);
    const name = `e2eupnpfault${Date.now()}`;
    const app = await buildApp(name);
    const [port] = app.spec.compose[0].ports;
    const mark = node.getLastEventId();
    await seedSpawnerApp(env, app, [NODE]);
    await waitForAppInstalled(node, name, 240000, { afterId: mark });
    expect((await gateway()).mappings.some((m) => m.externalPort === port), 'the app\'s port mapped').to.equal(true);

    await setUpnpDeleteFault(nodeIp, 501);
    const faultFrom = Date.now();
    const auth = await authenticate(node.url, fluxTeamKey());
    const res = await fetch(`${node.url}/apps/appremove/${name}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(node, name, 120000);

    // a pending removal would count every 5 s pass and reach the DOS inside this window
    const watchedUntil = Date.now() + DOS_WITHIN_MS;
    while (Date.now() < watchedUntil) {
      // eslint-disable-next-line no-await-in-loop
      expect((await dosOf(node)).dosMessage ?? null, 'never out of service').to.not.equal(UPNP_DOS);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 5000); });
    }
    await setUpnpDeleteFault(nodeIp, null);

    const { requests, mappings } = await gateway();
    const ofPort = requests.filter((r) => r.port === port && Date.parse(r.at) >= faultFrom);
    expect(ofPort.some((r) => r.action === 'DeletePortMapping' && r.refused === 501), 'canary: the router answered the removal with a fault').to.equal(true);
    expect(mappings.some((m) => m.externalPort === port), 'canary: and carried it out').to.equal(false);
    const lookup = ofPort.findIndex((r) => r.action === 'GetSpecificPortMappingEntry');
    expect(lookup, 'the retry looked the entry up').to.be.at.least(0);
    expect(ofPort.slice(lookup).filter((r) => r.action === 'DeletePortMapping'), 'no removal sent once it was found gone').to.have.length(0);
  });

  it('counts a mapping as its own while the router answers its lookup with a fault, until the router removes it', async function () {
    this.timeout(DOS_WITHIN_MS + RELEASED_WITHIN_MS + 400000);
    const name = `e2eupnplookup${Date.now()}`;
    const app = await buildApp(name);
    const [port] = app.spec.compose[0].ports;
    const mark = node.getLastEventId();
    await seedSpawnerApp(env, app, [NODE]);
    await waitForAppInstalled(node, name, 240000, { afterId: mark });
    expect((await gateway()).mappings.some((m) => m.externalPort === port), 'the app\'s port mapped').to.equal(true);

    await setUpnpLookupFault(nodeIp, 501);
    await setUpnpRefuseDeletes(nodeIp, Infinity);
    const faultFrom = Date.now();
    const auth = await authenticate(node.url, fluxTeamKey());
    const res = await fetch(`${node.url}/apps/appremove/${name}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(node, name, 120000);

    await waitFor(async () => (await dosOf(node)).dosMessage === UPNP_DOS, {
      timeout: DOS_WITHIN_MS, interval: 2000, label: 'the node out of service while the router keeps the mapping',
    });
    let state = await gateway();
    const ofPort = () => state.requests.filter((r) => r.port === port && Date.parse(r.at) >= faultFrom);
    expect(ofPort().some((r) => r.action === 'GetSpecificPortMappingEntry' && r.refused === 501), 'canary: a lookup answered with a fault').to.equal(true);
    const firstLookup = ofPort().findIndex((r) => r.action === 'GetSpecificPortMappingEntry');
    expect(ofPort().slice(firstLookup).some((r) => r.action === 'DeletePortMapping'), 'the removal sent after a lookup that settled nothing').to.equal(true);
    expect(state.mappings.some((m) => m.externalPort === port), 'the mapping still on the router').to.equal(true);

    await setUpnpRefuseDeletes(nodeIp, 0);
    await waitFor(async () => (await dosOf(node)).dosMessage !== UPNP_DOS, {
      timeout: RELEASED_WITHIN_MS, interval: 2000, label: 'the node back in service once the router removed the mapping',
    });
    await setUpnpLookupFault(nodeIp, null);
    state = await gateway();
    expect(state.mappings.some((m) => m.externalPort === port), 'the mapping removed').to.equal(false);
  });

  // The port refresh reads the installed apps, then maps each one's ports. It is held
  // at the app after its read, the app is removed while the router refuses the
  // removal of its mapping, and the refresh is let go: the removed app's port is
  // not mapped again, and its removal is still asked until the router carries it out.
  it('maps no port of an app removed while a refresh was on its way to it, and keeps asking the router to remove it', async function () {
    this.timeout(RELEASED_WITHIN_MS + 600000);
    const BEFORE_APP = 'portsRefresh:beforeApp';
    const name = `e2eupnprefresh${Date.now()}`;
    const app = await buildApp(name);
    const [port] = app.spec.compose[0].ports;
    const mark = node.getLastEventId();
    await seedSpawnerApp(env, app, [NODE]);
    await waitForAppInstalled(node, name, 240000, { afterId: mark });
    expect((await gateway()).mappings.some((m) => m.externalPort === port), 'the app\'s port mapped').to.equal(true);

    const holdFrom = node.getLastEventId();
    await node.holdCheckpoint(BEFORE_APP, name);
    try {
      await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_APP && d.key === name, 180000, { afterId: holdFrom });
      await setUpnpRefuseDeletes(nodeIp, Infinity);
      const auth = await authenticate(node.url, fluxTeamKey());
      const res = await fetch(`${node.url}/apps/appremove/${name}`, { headers: { zelidauth: auth.zelidauth } });
      await res.text();
      await waitForAppRemoved(node, name, 120000);
    } finally {
      await node.releaseCheckpoint(BEFORE_APP, name);
    }
    const releasedFrom = Date.now();
    const ofPortSince = (state) => state.requests.filter((r) => r.port === port && Date.parse(r.at) >= releasedFrom);

    // A mapping made again ends the removal's retries, so the wait ends at the first add too.
    let state;
    await waitFor(async () => {
      state = await gateway();
      const requests = ofPortSince(state);
      return requests.some((r) => r.action === 'AddPortMapping')
        || requests.filter((r) => r.action === 'DeletePortMapping').length >= 2;
    }, { timeout: RELEASED_WITHIN_MS, interval: 2000, label: 'the router asked again to remove the removed app\'s mapping' });
    expect(ofPortSince(state).filter((r) => r.action === 'AddPortMapping'), 'the removed app\'s port mapped again').to.deep.equal([]);
    expect(ofPortSince(state).filter((r) => r.action === 'DeletePortMapping').length, 'the removal asked again').to.be.at.least(2);

    await setUpnpRefuseDeletes(nodeIp, 0);
    await waitFor(async () => !(await gateway()).mappings.some((m) => m.externalPort === port), {
      timeout: RELEASED_WITHIN_MS, interval: 2000, label: 'the router removed the mapping once it would',
    });
  });
});
