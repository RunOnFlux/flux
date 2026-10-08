import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { execInContainer } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node whose resolv.conf lists a server that never answers ahead of a working one asks
// each in order, judges each on its own, and once the first has failed its probe skips it:
// its lookups are answered by the second without waiting on the first again.
//
// Node 1 is built with the dead-first-nameserver shape (test-infra/network-shapes.sh): its
// resolv.conf lists 192.0.2.1, which nothing holds, then the fleet's resolver. A target-less
// rule counts the queries sent to 192.0.2.1. The node's policy source is a host only it
// fetches, refreshed every few seconds, so the resolver's count of that host is its lookups.
//
// The first lookup asks the dead server for the A record and then probes it once, and the
// probe goes unanswered (dnsLookup.js). After that the server is skipped, and probed again
// at most once every REPROBE_MS, so over a window of lookups it is sent at most one query per
// REPROBE_MS begun; a node that judged its servers together would ask it on every lookup.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;
const SHAPED = 0;
const DEAD_SERVER = '192.0.2.1';
const REPROBE_MS = 30000;
const LOOKUPS = 3;

describe('a dead first nameserver is skipped once it fails its probe', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const ownA = async () => (await dnsRecordsServed())[POLICY_HOST]?.via?.own?.A ?? 0;
  const deadQueries = async () => {
    const { stdout } = await execInContainer(env.clients[SHAPED].container, 'iptables -L OUTPUT -v -x -n');
    const line = stdout.split('\n').find((l) => l.includes(DEAD_SERVER) && l.includes('dpt:53'));
    if (!line) throw new Error(`no counting rule for ${DEAD_SERVER}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'dead-first-nameserver' },
      dnsRecords: [{ name: POLICY_HOST, records: { A: getSubnetConfig().externalStub } }],
      nodeConfigOverrides: {
        [SHAPED]: { policy: { signedBaseUrl: `http://${POLICY_HOST}:3000`, refreshIntervalMs: 15000 } },
      },
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks the dead server, and is answered for the host by the next one', async function () {
    // The condition under test, shown present.
    this.timeout(90000);
    await waitFor(async () => (await deadQueries()) > 0 && (await ownA()) > 0, {
      timeout: 60000, label: `the shaped node to ask ${DEAD_SERVER} and then its next server for ${POLICY_HOST}`,
    });
  });

  it('holds the signed bundle', async function () {
    this.timeout(150000);
    const db = dbClient(SHAPED + 1);
    await waitFor(async () => Boolean(await db.policyBundle()), {
      timeout: 120000, label: `the shaped node to hold the bundle served by ${POLICY_HOST}`,
    });
  });

  it(`sends the dead server at most one probe per ${REPROBE_MS / 1000}s over ${LOOKUPS} lookups`, async function () {
    this.timeout(150000);
    const queriesBefore = await deadQueries();
    const servedBefore = await ownA();
    const startedAt = Date.now();
    await waitFor(async () => (await ownA()) >= servedBefore + LOOKUPS, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} more lookups of ${POLICY_HOST}`,
    });
    const allowed = Math.floor((Date.now() - startedAt) / REPROBE_MS) + 1;
    const queries = (await deadQueries()) - queriesBefore;
    expect(queries, `${queries} queries to ${DEAD_SERVER} over ${(await ownA()) - servedBefore} lookups`).to.be.at.most(allowed);
  });
});
