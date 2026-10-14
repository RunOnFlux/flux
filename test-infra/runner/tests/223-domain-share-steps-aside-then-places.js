import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp, buildSeedableTestApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, installedInstanceIndices, installingClaimIpsByNode, seedSpawnerApp,
  waitForInstanceCount, waitForLocationTable,
} from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A synced app whose running copy's fault domain already holds its share. The node
// in that domain steps aside for the domain-share window, so another domain may take
// the copy; if none has when the window ends, the node places it in its own domain.
//
// The fleet is six nodes split into two organisations by the location table: node
// indices 0, 2 and 4 in one, 1, 3 and 5 in the other. Two instances over two domains
// is a share of one per domain.
//
// Placement is ordered by seeding, never by racing: the spec reaches one node at a
// time, and a node the spec has not reached cannot select the app. So the copy each
// step expects can only land where the step says.

const DOMAINS = 2;
const DOMAIN_SHARE_WINDOW_MS = 60000;

// No tier's disk covers this: the largest benchmark ssd, 960 GB for STRATUS, leaves
// 912 once the spawner's 5% margin is taken. A node carrying it refuses every app at
// the spawner's space check, before it claims anything.
const NO_ROOM = { lockedSystemResources: { extrahdd: 1000 } };

const FIRST = 0; // holds the first copy, in the first domain
const STEPS_ASIDE = 2; // the first domain's second node, the one that defers
const OTHER_DOMAIN = 1; // the second domain's node that takes the copy when it can

const subnet = getSubnetConfig();

function domainOf(index) {
  const lastOctet = Number(subnet.nodeIp(index + 1).split('.')[3]);
  return lastOctet % DOMAINS;
}

function fleetConfig(nodeConfigOverrides = {}) {
  return {
    nodes: 6,
    tickerAutostart: false,
    locationTable: { domains: DOMAINS, subnet: subnet.base },
    // A six-ring reaches two outbound connections per node, not the shared minimum of four.
    configOverrides: {
      fluxapps: {
        minOutgoing: 2,
        minIncoming: 1,
        spawnDeferrals: { domainShareMs: { enterprise: DOMAIN_SHARE_WINDOW_MS, standard: DOMAIN_SHARE_WINDOW_MS } },
      },
    },
    nodeConfigOverrides,
  };
}

async function bootFleet(env) {
  await bootAndPeer(env, { minOutbound: 2, minInbound: 2 });
  // A spawn pass that runs before the table loads keys domains on /16 arithmetic,
  // where the whole fleet is one domain and no share applies.
  await Promise.all(env.clients.map((client) => waitForLocationTable(client, { domains: DOMAINS })));
}

async function buildApp(prefix) {
  const appName = `${prefix}${Date.now()}`;
  await pushTestApp(appName);
  const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });
  return { appName, app };
}

// The first copy, placed on FIRST alone, and known to STEPS_ASIDE before the spec
// reaches it: the share is counted from STEPS_ASIDE's own location view, so a copy it
// has not heard of does not count against its domain.
async function placeFirstCopy(env, app, appName) {
  await seedSpawnerApp(env, app, [FIRST]);
  await waitFor(
    async () => (await installedInstanceIndices(env, appName)).includes(FIRST),
    { timeout: 150000, interval: 3000, label: `${appName} installed on node index ${FIRST}` },
  );
  await waitFor(async () => {
    const view = await env.clients[STEPS_ASIDE].get(`/apps/location/${appName}`);
    return view.status === 'success'
      && view.data.some((location) => location.ip.split(':')[0] === subnet.nodeIp(FIRST + 1));
  }, { timeout: 60000, interval: 2000, label: `node index ${STEPS_ASIDE} sees the copy on node index ${FIRST}` });
}

function waitForShareDeferral(env, appName, afterId) {
  return env.clients[STEPS_ASIDE].waitForEvent(
    'spawner:deferred',
    (d) => d.appName === appName && d.reason === 'domain_share',
    60000,
    { afterId },
  );
}

function waitForShareDeferralToMature(env, appName, afterId) {
  return env.clients[STEPS_ASIDE].waitForEvent(
    'spawner:deferralMatured',
    (d) => d.appName === appName && d.reason === 'domain_share',
    DOMAIN_SHARE_WINDOW_MS + 90000,
    { afterId },
  );
}

describe('the domain share steps aside, then places', function () {
  describe('when no other domain has room', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(360000);
      // The whole second domain has no room, and neither does the first domain's
      // third node, so STEPS_ASIDE is the only node that can hold the second copy.
      env = await createTestEnv({
        hookCtx: this,
        ...fleetConfig({ 1: NO_ROOM, 3: NO_ROOM, 4: NO_ROOM, 5: NO_ROOM }),
      });
      await bootFleet(env);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('places the second copy in the full domain once the window ends', async function () {
      this.timeout(600000);
      const { appName, app } = await buildApp('e2esharestranded');
      await placeFirstCopy(env, app, appName);

      const anchor = env.clients[STEPS_ASIDE].getLastEventId();
      await seedSpawnerApp(env, app, [1, 2, 3, 4, 5]);
      await waitForShareDeferral(env, appName, anchor);
      await waitForShareDeferralToMature(env, appName, anchor);

      const placed = await waitForInstanceCount(env, appName, 2, { timeout: 150000, stableMs: 15000 });
      expect(placed).to.deep.equal([FIRST, STEPS_ASIDE]);
      expect(placed.map(domainOf), 'both copies in the first domain').to.deep.equal([domainOf(FIRST), domainOf(FIRST)]);
    });
  });

  describe('when another domain has room', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(360000);
      env = await createTestEnv({ hookCtx: this, ...fleetConfig() });
      await bootFleet(env);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('leaves the copy to the other domain and does not co-locate when the window ends', async function () {
      this.timeout(600000);
      // A spawn pass reaches its deferred apps only while some app on the network is
      // short, and once the other domain fills this one nothing else in the fleet is.
      // An app pinned to a node outside the fleet stays short and is never selected.
      const shortApp = await buildSeedableTestApp({
        name: `e2esharepinned${Date.now()}`, instances: 1, nodes: [`${subnet.nodeIp(40)}:16127`],
      });
      await seedSpawnerApp(env, shortApp);

      const { appName, app } = await buildApp('e2esharediverse');
      await placeFirstCopy(env, app, appName);

      const anchor = env.clients[STEPS_ASIDE].getLastEventId();
      await seedSpawnerApp(env, app, [STEPS_ASIDE]);
      await waitForShareDeferral(env, appName, anchor);

      await seedSpawnerApp(env, app, [OTHER_DOMAIN]);
      await waitFor(
        async () => (await installedInstanceIndices(env, appName)).includes(OTHER_DOMAIN),
        { timeout: 150000, interval: 3000, label: `${appName} installed on node index ${OTHER_DOMAIN}` },
      );

      // The deferral coming back is what makes "no third copy" an observation rather
      // than an absence: without it, a spawner that never returned would also pass.
      await waitForShareDeferralToMature(env, appName, anchor);
      const placed = await waitForInstanceCount(env, appName, 2, { timeout: 30000, stableMs: 20000 });
      expect(placed).to.deep.equal([FIRST, OTHER_DOMAIN]);
      expect(new Set(placed.map(domainOf)).size, 'the copies in two domains').to.equal(DOMAINS);

      const claims = await installingClaimIpsByNode(env, appName);
      const stepsAsideIp = subnet.nodeIp(STEPS_ASIDE + 1);
      claims.forEach((view, index) => {
        expect(view, `node index ${index} answered for its installing claims`).to.not.equal(null);
        expect(view.map((ip) => ip.split(':')[0]), `node index ${index} holds a claim from node index ${STEPS_ASIDE}`).to.not.include(stepsAsideIp);
      });
    });
  });
});
