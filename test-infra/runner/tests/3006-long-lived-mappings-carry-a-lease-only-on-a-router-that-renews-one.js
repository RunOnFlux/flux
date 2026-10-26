// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { enableUpnpGateway, setUpnpLeases, upnpGatewayState } from '../framework/external-http-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node learns at start, after mapping its own ports, whether its router restarts a
// mapping's lease when the mapping is added again: it maps its test port for
// renewalTestLeaseS, adds it again halfway through, and looks it up 10 s after the first
// lease would have ended. On a router that renews - whether its lease counts down or is shown
// as asked - its own ports and its apps' are refreshed with longLivedLeaseS. On a router that
// keeps a held entry as it is, or refuses a lease, they stay permanent. Until the answer,
// they are permanent everywhere; an app's ports are first mapped at boot, once its firewall
// ports are open.

const API_PORT = 16127;
const TEST_PORT = API_PORT + 3;
const APP_PORT = 31006;
const RENEWAL_TEST_LEASE_S = 30;
// The renewal test adds its mapping again halfway through the lease and looks it up 10 s
// after the first lease would have ended, which is before a renewed lease ends only when
// half the lease is longer than those 10 s.
if (RENEWAL_TEST_LEASE_S / 2 <= 10) {
  throw new Error('3006: a renewed lease must outlast the renewal test\'s lookup');
}
const LONG_LEASE_S = 35 * 60;
// A restarted node has bootSyncTimeoutMs to sync its app state before it removes every app
// it holds; the shared fleet's 30 s would decide that race for the harness, so it is
// production's here.
const BOOT_SYNC_TIMEOUT_MS = 300000;
// The renewal test, then one refresh cycle (portRestoreIntervalMs, 30 s in the harness), with
// room for the boot that precedes them.
const ANSWERED_AND_REFRESHED_MS = 240000;

describe('long-lived mappings carry a lease only on a router that renews one', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let nodeIp;
  let startedAt = 0;
  const appName = `e2eleases${Date.now()}`;
  const since = (requests) => requests.filter((r) => Date.parse(r.at) >= startedAt);
  const adds = (requests, port) => since(requests).filter((r) => r.action === 'AddPortMapping' && r.port === port);
  // the api port (TCP) and both protocols of the app's port refreshed with `lease`
  const refreshedWith = (requests, lease) => adds(requests, API_PORT).some((r) => r.lease === lease)
    && ['TCP', 'UDP'].every((protocol) => adds(requests, APP_PORT).some((r) => r.protocol === protocol && r.lease === lease));
  const renewalTestAdds = (requests) => since(requests)
    .filter((r) => r.action === 'AddPortMapping' && r.port === TEST_PORT && r.lease === RENEWAL_TEST_LEASE_S);
  const renewalTestLookup = (requests) => since(requests)
    .find((r) => r.action === 'GetSpecificPortMappingEntry' && r.port === TEST_PORT
      && renewalTestAdds(requests).length === 2 && Date.parse(r.at) > Date.parse(renewalTestAdds(requests)[1].at));

  // A clean table behind the router as `leases` sets it, and FluxOS started again on it.
  const restartOnRouter = async (leases) => {
    await enableUpnpGateway(nodeIp);
    if (leases) await setUpnpLeases(nodeIp, leases);
    startedAt = Date.now();
    await restartFluxos(env.clients[idx].container);
  };

  // Resolves with the gateway's state once `done` holds of it.
  const gatewayOnce = async (done, label) => {
    let state = { requests: [], mappings: [] };
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      return done(state);
    }, { timeout: ANSWERED_AND_REFRESHED_MS, interval: 2000, label });
    return state;
  };

  // The node's api port and its app's port, both protocols, held with a lease of `lease`.
  const heldWith = (state, lease) => {
    const held = state.mappings
      .filter((m) => m.externalPort === API_PORT || m.externalPort === APP_PORT)
      .map((m) => `${m.externalPort}/${m.protocol} ${m.leaseDuration}`)
      .sort();
    expect(held).to.include(`${API_PORT}/TCP ${lease}`);
    expect(held).to.include.members([`${APP_PORT}/TCP ${lease}`, `${APP_PORT}/UDP ${lease}`]);
  };

  // Every mapping of the node's api port and its app's port made since the start, with no
  // lease - checked once a refresh has come round after the renewal test answered.
  const neverLeased = async (afterAnswer) => {
    const state = await gatewayOnce((s) => afterAnswer(s)
      && adds(s.requests, API_PORT).some((r) => Date.parse(r.at) > afterAnswer(s))
      && adds(s.requests, APP_PORT).some((r) => Date.parse(r.at) > afterAnswer(s)), 'a refresh after the renewal test answered');
    const leases = [...adds(state.requests, API_PORT), ...adds(state.requests, APP_PORT)].map((r) => r.lease);
    expect(leases.length, 'canary: the api port and the app port mapped').to.be.at.least(4);
    expect([...new Set(leases)], 'the leases they were mapped with').to.deep.equal([0]);
    heldWith(state, 0);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
        system: { bootSyncTimeoutMs: BOOT_SYNC_TIMEOUT_MS },
        upnp: { renewalTestLeaseS: RENEWAL_TEST_LEASE_S },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'long-lived leases',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [APP_PORT],
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
    idx = await seedAndInstall(env, app);
    nodeIp = subnet.nodeIp(idx + 1);
    // a node with an api port in its userconfig verifies UPnP when it starts
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(env.clients[idx].container, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('leases its own ports and its app\'s on a router that renews a lease', async function () {
    this.timeout(ANSWERED_AND_REFRESHED_MS + 60000);
    await restartOnRouter(null);

    const state = await gatewayOnce((s) => refreshedWith(s.requests, LONG_LEASE_S), 'its api port and its app\'s refreshed with the long lease');

    expect(renewalTestAdds(state.requests).length, 'the renewal test: a mapping and its refresh').to.equal(2);
    expect(renewalTestLookup(state.requests), 'the renewal test: the lookup after the first lease').to.not.equal(undefined);
    // mapped at boot before the answer, and refreshed with the lease after it
    expect(adds(state.requests, API_PORT)[0].lease, 'the api port first mapped with no lease').to.equal(0);
    expect(adds(state.requests, APP_PORT)[0].lease, 'the app port first mapped with no lease').to.equal(0);
    heldWith(state, LONG_LEASE_S);
  });

  it('leases them on a router that renews and shows every lease as asked', async function () {
    this.timeout(ANSWERED_AND_REFRESHED_MS + 60000);
    await restartOnRouter({ staticLeases: true });

    const state = await gatewayOnce((s) => refreshedWith(s.requests, LONG_LEASE_S), 'its api port and its app\'s refreshed with the long lease');

    expect(renewalTestAdds(state.requests).length, 'the renewal test: a mapping and its refresh').to.equal(2);
    heldWith(state, LONG_LEASE_S);
  });

  it('keeps them permanent on a router that leaves a held entry as it is', async function () {
    this.timeout(ANSWERED_AND_REFRESHED_MS + 60000);
    await restartOnRouter({ keepsHeld: true });

    await neverLeased((s) => {
      const lookup = renewalTestLookup(s.requests);
      return lookup ? Date.parse(lookup.at) : 0;
    });
  });

  it('keeps them permanent, and runs no renewal test, on a router that refuses a lease', async function () {
    this.timeout(ANSWERED_AND_REFRESHED_MS + 60000);
    await restartOnRouter({ fault: 725 });

    // no renewal test to answer: a refresh after the app's boot mapping
    await neverLeased((s) => {
      const [boot] = adds(s.requests, APP_PORT);
      return boot ? Date.parse(boot.at) : 0;
    });
    const state = await upnpGatewayState(nodeIp);
    expect(renewalTestAdds(state.requests), 'renewal test mappings').to.deep.equal([]);
  });
});
