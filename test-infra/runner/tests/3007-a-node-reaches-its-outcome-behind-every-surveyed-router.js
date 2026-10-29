// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { upnpGatewayState } from '../framework/external-http-control.js';
import { ROUTERS, putBehindRouter } from '../framework/upnp-routers.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node started behind each router profile (framework/upnp-routers.js) reaches the outcome
// the profile names: whether it verifies UPnP, whether its renewal test runs and what it
// shows, and the lease its api port is then refreshed with - leased for longLivedLeaseS on
// a router that renews, permanent on every other - with the renewal test's mapping not left
// on the router.

const API_PORT = 16127;
const TEST_PORT = API_PORT + 3;
const RENEWAL_TEST_LEASE_S = 30;
// The renewal test adds its mapping again halfway through the lease and looks it up 10 s
// after the first lease would have ended, which is before a renewed lease ends only when
// half the lease is longer than those 10 s.
if (RENEWAL_TEST_LEASE_S / 2 <= 10) {
  throw new Error('3007: a renewed lease must outlast the renewal test\'s lookup');
}
const LONG_LEASE_S = 35 * 60;
// A restart, the UPnP verify, the renewal test (RENEWAL_TEST_LEASE_S + 10 s) and one refresh
// cycle (portRestoreIntervalMs, 30 s in the harness).
const VERIFIED_MS = 180000;
const ANSWERED_MS = 120000;
const REFRESHED_MS = 90000;

describe('a node reaches its outcome behind every surveyed router', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const NODE = 0;
  const nodeIp = subnet.nodeIp(NODE + 1);

  const since = (requests, at) => requests.filter((r) => Date.parse(r.at) >= at);
  const apiAdds = (requests, at) => since(requests, at)
    .filter((r) => r.action === 'AddPortMapping' && r.port === API_PORT && !r.refused);
  const renewalTestAdds = (requests, at) => since(requests, at)
    .filter((r) => r.action === 'AddPortMapping' && r.port === TEST_PORT && r.lease === RENEWAL_TEST_LEASE_S);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
        upnp: { renewalTestLeaseS: RENEWAL_TEST_LEASE_S },
      },
    });
    // the first boot writes userconfig.js; a node with an api port in it verifies UPnP when
    // it starts
    await waitForBootSettled(env.clients[NODE]);
    await setNodeApiPort(env.clients[NODE].container, API_PORT);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  Object.entries(ROUTERS).forEach(([name, router]) => {
    it(`${name}: ${router.expect}`, async function () {
      this.timeout(VERIFIED_MS + ANSWERED_MS + REFRESHED_MS + 60000);
      const client = env.clients[NODE];
      const afterId = client.getLastEventId();
      await putBehindRouter(nodeIp, name);
      const startedAt = Date.now();
      await restartFluxos(client.container);

      const verified = await client.waitForEvent('upnp:verified', () => true, VERIFIED_MS, { afterId });
      if (router.expect === 'unverified') {
        expect(verified.data.verified, 'UPnP verified').to.equal(false);
        const state = await upnpGatewayState(nodeIp);
        expect(since(state.requests, startedAt).some((r) => r.action === 'AddPortMapping' && r.port === TEST_PORT && r.refused),
          'canary: the verify asked for its test mapping and was refused').to.equal(true);
        expect(apiAdds(state.requests, startedAt), 'mappings of the api port').to.deep.equal([]);
        return;
      }
      expect(verified.data.verified, 'UPnP verified').to.equal(true);

      const renewal = await client.waitForEvent('upnp:leaseRenewal', () => true, ANSWERED_MS, { afterId });
      const answeredAt = Date.now();
      expect(renewal.data.renews, 'the router renews').to.equal(router.expect === 'renews');

      // a refresh of the api port after the answer, and the renewal test's mapping removed
      const lease = router.expect === 'renews' ? LONG_LEASE_S : 0;
      let state = { requests: [], mappings: [] };
      await waitFor(async () => {
        state = await upnpGatewayState(nodeIp);
        return apiAdds(state.requests, answeredAt).length > 0
          && !state.mappings.some((m) => m.externalPort === TEST_PORT);
      }, { timeout: REFRESHED_MS, interval: 2000, label: 'the api port refreshed after the answer, and the test port free' });

      expect(apiAdds(state.requests, answeredAt).map((r) => r.lease), 'the api port refreshed with').to.include(lease);
      const held = state.mappings.find((m) => m.externalPort === API_PORT && m.protocol === 'TCP');
      expect(held, 'the api port held').to.not.equal(undefined);
      if (lease > 0) expect(held.leaseDuration, 'the api port held with the long lease').to.be.at.least(LONG_LEASE_S);
      else expect(held.leaseDuration, 'the api port held with no lease').to.equal(0);
      expect(renewalTestAdds(state.requests, startedAt).length > 0, 'the renewal test ran')
        .to.equal(router.expect !== 'keeps-no-lease');
    });
  });
});
