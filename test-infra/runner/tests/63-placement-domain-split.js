import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The other half of the placement share, and the half the /16 key could never
// express: a fleet that LOOKS like one network but is several fault domains.
//
// Suite 62 proves the permissive direction - one domain absorbs every instance
// so a country-pinned app converges. This proves the restrictive direction on
// the same wire: with the location table splitting the fleet into distinct
// organisations, a synced app must spread across them rather than stack. Every
// node here shares a /16, so the retired rule and the table-less fallback both
// see exactly one domain and cannot distinguish these two suites at all - only
// a node that fetched, parsed and consulted the real artifact can.
//
// That makes this the first harness coverage of the table path end to end:
// the stub serves it, ipLocationSync fetches and caches it, ipLocationTable
// parses it, and faultDomain keys placement on its organisations.

describe('placement share spreads synced instances across table fault domains', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    // three organisations across the fleet's /24, published before the nodes
    // boot so their first fetch already carries the split
    const response = await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 3 }),
    });
    expect(response.ok, 'stub accepted the split artifact').to.equal(true);
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(30000);
    // leave the stub on its single-domain default for whatever runs next
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await env?.teardown();
  });

  it('places one instance per organisation and holds there', async function () {
    this.timeout(200000);
    const appName = `e2edomsplit${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31141], instances: 3,
    });
    await seedSpawnerApp(env, app);

    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 150000, stableMs: 15000 });
    expect(placed.length).to.equal(3);

    // The share for three instances over three domains is one each, so the
    // three placements must sit in three different organisations. The stub
    // splits each /24 into equal last-octet buckets, so the bucket index is
    // the domain: this asserts the instances actually spread rather than
    // landing anywhere and passing on count alone.
    // waitForInstanceCount resolves to node INDICES, not locations.
    const subnet = getSubnetConfig();
    const buckets = placed.map((nodeIndex) => {
      const lastOctet = Number(subnet.nodeIp(nodeIndex + 1).split('.')[3]);
      return Math.floor(lastOctet / Math.ceil(256 / 3));
    });
    expect(new Set(buckets).size, `expected 3 distinct fault domains, got buckets ${buckets}`).to.equal(3);
  });
});
