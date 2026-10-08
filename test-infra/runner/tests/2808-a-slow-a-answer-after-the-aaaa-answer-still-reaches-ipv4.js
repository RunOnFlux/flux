import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, waitForLocationTable } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node whose IPv6 is configured and does not route reaches a host at its IPv4 address when
// the host's A answer arrives after its AAAA answer, as a recursive resolver with a cold cache
// gives them.
//
// Every node holds a global IPv6 address with no IPv6 route beyond it (createTestEnv
// globalIpv6), so it asks for both record types and every IPv6 connection fails at once. The
// policy host's AAAA query is answered at once and its A query A_AFTER_MS later. The host is the
// policy source for every node, so a node holds the bundle only if a lookup gave it the host's
// IPv4 address; no node can take it from a peer that did not.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;
// Beyond the lookup's Resolution Delay, within its query timeout (dnsLookup.js).
const A_AFTER_MS = 500;

describe('a slow A answer after the AAAA answer still reaches the host at its IPv4 address', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      globalIpv6: Array.from({ length: NODES }, (_, i) => i),
      dnsRecords: [{
        name: POLICY_HOST,
        records: { A: { answer: getSubnetConfig().externalStub, afterMs: A_AFTER_MS }, AAAA: '2001:db8:5::1' },
      }],
      configOverrides: {
        policy: { signedBaseUrl: `http://${POLICY_HOST}:3000`, refreshIntervalMs: 15000 },
      },
      // Whether this fleet obtains policy at all is what the suite asserts.
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks for the host\'s A and AAAA records', async function () {
    // The condition under test, shown present.
    this.timeout(90000);
    await waitFor(async () => {
      const served = (await dnsRecordsServed())[POLICY_HOST]?.served ?? {};
      return served.AAAA > 0 && served.A > 0;
    }, { timeout: 60000, label: `a node to ask for ${POLICY_HOST}'s A and AAAA records` });
  });

  it('holds the signed bundle on every node', async function () {
    this.timeout(150000);
    const dbs = Array.from({ length: NODES }, (_, i) => dbClient(i + 1));
    await waitFor(async () => {
      const bundles = await Promise.all(dbs.map((db) => db.policyBundle()));
      return bundles.every(Boolean);
    }, { timeout: 120000, label: `every node to hold the bundle served by ${POLICY_HOST}` });
  });

  it('installs on every node the location table the bundle names, fetched from the host', async function () {
    this.timeout(150000);
    await Promise.all(env.clients.map((client) => waitForLocationTable(client, { timeout: 120000 })));
  });
});
