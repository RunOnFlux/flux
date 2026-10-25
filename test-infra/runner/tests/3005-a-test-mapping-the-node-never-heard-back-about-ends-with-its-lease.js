// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  enableUpnpGateway, setUpnpLeases, setUpnpSlowAdds, upnpGatewayState,
} from '../framework/external-http-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node's test mappings - its UPnP check's and its port test's - carry a lease on a router
// that keeps one, so a test mapping the router took after the node stopped waiting for its
// answer goes when the lease ends: the node never heard it was made, and never removes it.
// A node removes the test mappings it left once per start, in its stale-mapping cleanup,
// so the late mapping is made only once that pass has run: from then on only its lease
// can end it.
// The UPnP check reads its mapping back to learn whether the router keeps a lease. On a
// router that refuses one - with 725, as MikroTik does, or with any other fault - or that
// holds a leased mapping as permanent, the node is in service as on any router, and its
// test mappings are made with no lease.

const NODE = 0;
const LEASE_S = 40;
// longer than the UPnP client waits for an answer (10 s)
const SLOW_ADD_MS = 12000;
// the port test's question to a peer
const PEER_ASK_MS = 10000;
// The stale-mapping cleanup runs once per start, in this node's slot of a cycle of
// upnpService's CLEANUP_CYCLE_MS (10 minutes), so it has run within one cycle of the boot.
const CLEANUP_CYCLE_MS = 10 * 60 * 1000;
if (LEASE_S * 1000 <= SLOW_ADD_MS + PEER_ASK_MS) {
  throw new Error('3005: a test mapping\'s lease must outlast the test that holds it');
}
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: 15000, error: 3000, failure: 1000, dos: 15000, appError: 3000,
  },
  thresholds: { dos: 100000, portsHighEdge: 3, portsLowEdge: 1 },
};

describe('a test mapping the node never heard back about ends with its lease', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let node;
  let nodeIp;
  // when FluxOS last started on the node, for the cleanup pass that follows it
  let startedAt = 0;
  const gateway = () => upnpGatewayState(nodeIp);
  const adds = (requests, description, sinceMs = 0) => requests.filter((r) => r.action === 'AddPortMapping'
    && r.description === description && Date.parse(r.at) >= sinceMs);

  // A clean table behind the router as `leases` sets it, and FluxOS started again on it,
  // so the UPnP check asks the router afresh. Resolves once the node has mapped its api
  // port and run a port test.
  const restartOnRouter = async (leases) => {
    await enableUpnpGateway(nodeIp);
    if (leases) await setUpnpLeases(nodeIp, leases);
    const from = Date.now();
    startedAt = from;
    await restartFluxos(node.container);
    await waitForBootSettled(node);
    let state = { requests: [] };
    await waitFor(async () => {
      state = await gateway();
      return state.requests.some((r) => r.action === 'AddPortMapping' && r.port === 16127 && !r.refused)
        && adds(state.requests, 'Flux_Test_App', from).length > 0;
    }, { timeout: 300000, interval: 2000, label: 'the node mapped its api port and ran a port test' });
    return state;
  };

  // On a router that does not keep a lease: verified, in service, and every port test's
  // mapping made with no lease.
  const inServiceWithPermanentTestMappings = async (state) => {
    const tests = adds(state.requests, 'Flux_Test_App');
    expect(tests.length, 'canary: a port test ran').to.be.at.least(1);
    expect(tests.map((r) => r.lease), 'the leases of the port test\'s mappings').to.deep.equal(tests.map(() => 0));
    expect(tests.filter((r) => r.refused), 'refused port test mappings').to.deep.equal([]);
    expect(state.mappings.some((m) => m.externalPort === 16127), 'the node\'s api port mapped').to.equal(true);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
      nodeConfigOverrides: { [NODE]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK }, upnp: { testMappingLeaseS: LEASE_S } } },
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
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('leases its test mappings on a router that keeps a lease', async function () {
    this.timeout(360000);
    const state = await restartOnRouter(null);

    const [check] = adds(state.requests, 'Flux_UPNP_Mapping_Test');
    expect(check?.lease, 'the UPnP check\'s mapping').to.equal(LEASE_S);
    const tests = adds(state.requests, 'Flux_Test_App');
    expect(tests.map((r) => r.lease), 'the leases of the port test\'s mappings').to.deep.equal(tests.map(() => LEASE_S));
    expect(state.mappings.some((m) => m.externalPort === 16127 && m.leaseDuration === 0), 'the node\'s api port mapped with no lease').to.equal(true);
  });

  it('leaves a test mapping the router answered too late for to its lease, which ends it', async function () {
    this.timeout(CLEANUP_CYCLE_MS + LEASE_S * 1000 + 360000);
    // the cleanup lists the router's table once per start, and removes what it lists then
    await waitFor(async () => {
      const { requests } = await gateway();
      const listed = requests.filter((r) => r.action === 'GetGenericPortMappingEntry' && Date.parse(r.at) >= startedAt);
      return listed.length > 0 && Date.now() - Date.parse(listed[listed.length - 1].at) > 5000;
    }, { timeout: CLEANUP_CYCLE_MS + 120000, interval: 2000, label: 'the node\'s stale-mapping cleanup has run since it started' });
    const from = Date.now();
    await setUpnpSlowAdds(nodeIp, { ms: SLOW_ADD_MS, description: 'Flux_Test_App' });
    let late = null;
    await waitFor(async () => {
      const { requests } = await gateway();
      late = adds(requests, 'Flux_Test_App', from).find((r) => r.answeredAfterMs) ?? null;
      return late !== null && Date.now() - Date.parse(late.at) > SLOW_ADD_MS;
    }, { timeout: 240000, interval: 2000, label: 'a port test mapping the router answered too late for' });
    await setUpnpSlowAdds(nodeIp, { ms: null });

    const held = (await gateway()).mappings.find((m) => m.externalPort === late.port && m.protocol === late.protocol);
    expect(held, 'canary: the router holds the mapping it answered too late for').to.not.equal(undefined);
    expect(held.leaseDuration, 'its lease').to.equal(LEASE_S);

    let state = null;
    await waitFor(async () => {
      state = await gateway();
      return !state.mappings.some((m) => m.externalPort === late.port && m.protocol === late.protocol);
    }, { timeout: LEASE_S * 1000 + 30000, interval: 2000, label: 'the router ends the mapping when its lease does' });
    expect(state.requests.filter((r) => r.action === 'DeletePortMapping' && r.port === late.port && r.protocol === late.protocol), 'the node removed it').to.deep.equal([]);
  });

  it('is in service on a router that keeps permanent mappings only, with its test mappings made with no lease', async function () {
    this.timeout(360000);
    const state = await restartOnRouter({ fault: 725 });

    const checks = adds(state.requests, 'Flux_UPNP_Mapping_Test');
    expect(checks.map((r) => [r.lease, r.refused ?? null]), 'the UPnP check\'s mappings').to.deep.equal([[LEASE_S, 725], [0, null]]);
    await inServiceWithPermanentTestMappings(state);
  });

  it('is in service on a router that refuses a lease with another fault, with its test mappings made with no lease', async function () {
    this.timeout(360000);
    const state = await restartOnRouter({ fault: 402 });

    const checks = adds(state.requests, 'Flux_UPNP_Mapping_Test');
    expect(checks.map((r) => [r.lease, r.refused ?? null]), 'the UPnP check\'s mappings').to.deep.equal([[LEASE_S, 402], [0, null]]);
    await inServiceWithPermanentTestMappings(state);
  });

  it('makes its test mappings with no lease on a router that holds a leased mapping as permanent', async function () {
    this.timeout(360000);
    const state = await restartOnRouter({ drops: true });

    const checks = adds(state.requests, 'Flux_UPNP_Mapping_Test');
    expect(checks.map((r) => [r.lease, r.refused ?? null]), 'the UPnP check\'s mapping').to.deep.equal([[LEASE_S, null]]);
    await inServiceWithPermanentTestMappings(state);
  });
});
