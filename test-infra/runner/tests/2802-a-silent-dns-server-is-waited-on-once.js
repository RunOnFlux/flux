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

// A node whose own DNS server never answers reaches a host through the public DNS
// servers, and waits on its own server once rather than on every lookup.
//
// Node 1 is built with the silent-dns shape (test-infra/network-shapes.sh): its
// resolv.conf names a server that never answers, and the public servers FluxOS asks
// next are the fleet's resolver, which answers the policy host's A query and counts
// each answer. That count is the node's lookups of the host: its own server cannot
// reach the resolver, so every answer went by the public route.
//
// The host is the shaped node's policy source, and no other node's, so every answer
// counted is one of its lookups. It fetches from it on every refresh through the main
// thread's global agent, and so through the lookup FluxOS installs there; the refresh
// is compressed so lookups come every few seconds.
//
// The first lookup asks the silent server once per family and then probes it once, and the
// probe goes unanswered (dnsLookup.js). After that the server is skipped, and probed again at
// most once every REPROBE_MS, so over a window of lookups it is sent at most one query per
// REPROBE_MS begun, where a node that did not remember it would send each lookup's queries
// and a probe.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;
const SHAPED = 0;
const SILENT_SERVER = '192.0.2.1';
const REPROBE_MS = 30000;
const LOOKUPS = 3;

describe('a node whose own DNS server is silent waits on it once', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const servedA = async () => (await dnsRecordsServed())[POLICY_HOST]?.served?.A ?? 0;
  // Queries the shaped node has sent its own DNS server, by the shape's counting rule.
  const silentQueries = async () => {
    const { stdout } = await execInContainer(env.clients[SHAPED].container, 'iptables -L OUTPUT -v -x -n');
    const line = stdout.split('\n').find((l) => l.includes(SILENT_SERVER) && l.includes('dpt:53'));
    if (!line) throw new Error(`no counting rule for ${SILENT_SERVER}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'silent-dns' },
      dnsRecords: [{ name: POLICY_HOST, records: { A: getSubnetConfig().externalStub } }],
      nodeConfigOverrides: {
        [SHAPED]: { policy: { signedBaseUrl: `http://${POLICY_HOST}:3000`, refreshIntervalMs: 15000 } },
      },
      // Whether the shaped node obtains policy at all is what the suite asserts.
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks its own DNS server, and is answered for the host by the public servers', async function () {
    // The condition under test, shown present.
    this.timeout(90000);
    await waitFor(async () => (await silentQueries()) > 0 && (await servedA()) > 0, {
      timeout: 60000, label: `the shaped node to ask ${SILENT_SERVER} and the public servers for ${POLICY_HOST}`,
    });
  });

  it('holds the signed bundle', async function () {
    this.timeout(150000);
    const db = dbClient(SHAPED + 1);
    await waitFor(async () => Boolean(await db.policyBundle()), {
      timeout: 120000, label: `the shaped node to hold the bundle served by ${POLICY_HOST}`,
    });
  });

  it(`sends its own server at most one probe per ${REPROBE_MS / 1000}s over ${LOOKUPS} lookups`, async function () {
    this.timeout(150000);
    const queriesBefore = await silentQueries();
    const servedBefore = await servedA();
    const startedAt = Date.now();
    await waitFor(async () => (await servedA()) >= servedBefore + LOOKUPS, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} more lookups of ${POLICY_HOST}`,
    });
    const allowed = Math.floor((Date.now() - startedAt) / REPROBE_MS) + 1;
    const lookups = (await servedA()) - servedBefore;
    const queries = (await silentQueries()) - queriesBefore;
    expect(queries, `${queries} queries to ${SILENT_SERVER} over ${lookups} lookups`).to.be.at.most(allowed);
  });
});
