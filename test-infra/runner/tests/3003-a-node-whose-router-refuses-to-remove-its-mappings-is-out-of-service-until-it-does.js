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
import { enableUpnpGateway, setUpnpRefuseDeletes, upnpGatewayState } from '../framework/external-http-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import {
  waitFor, waitForAppInstalled, waitForAppRemoved, waitForBootSettled,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const subnet = getSubnetConfig();

// A node behind UPnP whose router refuses to remove its mappings is out of
// service until the router removes them. Its availability check waits ten
// minutes after a passing test and ten in DOS, so only UPnP reaching it can
// start a pass sooner: an app's removal the router refuses starts the next pass
// at once, each pass while it stays refused makes no test mapping and counts
// toward the DOS, and the router taking the removal starts the pass that tests
// and releases the node.

const NODE = 0;
const LONG_WAIT_MS = 10 * 60 * 1000;
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: LONG_WAIT_MS, error: 5000, failure: 1000, dos: LONG_WAIT_MS, appError: 5000,
  },
  thresholds: { dos: 100, portsHighEdge: 3, portsLowEdge: 1 },
};
// 25 counted passes, 5 s apart, reach the threshold of 100
const DOS_WITHIN_MS = 4 * 60 * 1000;
// the harness's longest removal retry (8 s) and one pass
const RELEASED_WITHIN_MS = 90 * 1000;
const UPNP_DOS = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
const LISTEN_PORT = 8080;

const dosOf = async (client) => (await client.getDOSState()).data ?? {};

describe('a node whose router refuses to remove its mappings is out of service until it does', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let node;
  let nodeIp;
  let appName;
  let appPort;
  const gateway = () => upnpGatewayState(nodeIp);
  const testMappings = (requests, sinceMs = 0) => requests.filter((r) => r.action === 'AddPortMapping'
    && r.description === 'Flux_Test_App' && Date.parse(r.at) >= sinceMs);

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

    const { requests } = await gateway();
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.description === 'Flux_UPNP_Mapping_Test'), 'canary: the node verified UPnP on its gateway').to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('tests its ports over TCP alone, and waits the long wait after a test that passed', async function () {
    this.timeout(300000);
    let state = { requests: [] };
    await waitFor(async () => {
      state = await gateway();
      const [first] = testMappings(state.requests);
      return Boolean(first) && state.requests.some((r) => r.action === 'DeletePortMapping'
        && r.port === first.port && Date.parse(r.at) >= Date.parse(first.at));
    }, { timeout: 240000, interval: 2000, label: 'a test mapping made and removed' });

    const made = testMappings(state.requests);
    expect(made.map((r) => r.protocol), 'TCP only').to.deep.equal(made.map(() => 'TCP'));

    // a failed test is retried within seconds; a passed one only after the long wait
    const quietFrom = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, 30000); });
    expect(testMappings((await gateway()).requests, quietFrom), 'no test mapping in the long wait').to.have.length(0);
    expect((await dosOf(node)).dosMessage ?? null).to.not.equal(UPNP_DOS);
  });

  it('is out of service, with no new test mapping, once its router has refused an app\'s removal for as many passes as the threshold takes', async function () {
    this.timeout(DOS_WITHIN_MS + 400000);
    await pushBusybox('e2eupnprefuse', 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    appName = `e2eupnprefuse${Date.now()}`;
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
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

  it('is back in service soon after its router removes the mapping', async function () {
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
});
