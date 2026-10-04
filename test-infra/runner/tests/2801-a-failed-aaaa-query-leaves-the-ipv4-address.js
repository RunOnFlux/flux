import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, waitForLocationTable } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node whose DNS server answers a host's A query and fails its AAAA query with SERVFAIL
// reaches that host at its IPv4 address.
//
// Routers that SERVFAIL every AAAA query are common on home connections. The host here is
// the policy source, reached by name on every node: the fleet takes the signed bundle from
// it, and each node fetches the location table the bundle names from it, all through the
// main thread's global agent and so through the lookup FluxOS installs there.
//
// Three nodes, peered, because the table fetch starts once a node's app database is
// ready, and a node that never peers never gets there. The backstop period is compressed so
// the first fetch from the source lands within the suite's patience rather than within a
// day.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;

describe('a host whose AAAA query fails is reached at its IPv4 address', function () {
  let env;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      dnsRecords: [{
        name: POLICY_HOST,
        records: { A: getSubnetConfig().externalStub, AAAA: 'SERVFAIL' },
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

  it('asks for the host\'s AAAA records and is answered with SERVFAIL', async function () {
    // The condition under test, shown present: without it, everything below would pass
    // against any lookup at all.
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
