import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsBrokenServed, dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node whose own DNS server leaves the A query unanswered and answers the AAAA query
// SERVFAIL, for every name, as a resolver whose upstream is gone does, reaches a host through
// the public DNS servers and waits on its own server once rather than on every lookup.
//
// Node 1 is built with the aaaa-servfail-dns shape (test-infra/network-shapes.sh): its own
// DNS server is the fleet resolver's broken route, which counts each query by type, and the
// public servers FluxOS asks next are the fleet's resolver, which answers the policy host.
// The node holds a global IPv6 address (createTestEnv globalIpv6), so a lookup asks for both
// record types.
//
// One family unanswered sends the probe (dnsLookup.js). The probe, an A query, goes
// unanswered, so the server is remembered as silent: later lookups skip it, and it is probed
// again at most once every REPROBE_MS. So the server receives one AAAA query, from the first
// lookup, however many lookups follow; a node that did not probe would send it an A and an
// AAAA query on every lookup.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;
const SHAPED = 0;
const REPROBE_MS = 30000;
const LOOKUPS = 3;

describe('a node whose own DNS server answers only AAAA, with SERVFAIL, waits on it once', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const servedA = async () => (await dnsRecordsServed())[POLICY_HOST]?.served?.A ?? 0;
  const broken = async () => {
    const counts = await dnsBrokenServed();
    return { A: counts.A ?? 0, AAAA: counts.AAAA ?? 0 };
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'aaaa-servfail-dns' },
      globalIpv6: [SHAPED],
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

  it('asks its own DNS server for both record types, and is answered for the host by the public servers', async function () {
    // The condition under test, shown present.
    this.timeout(90000);
    await waitFor(async () => {
      const counts = await broken();
      return counts.A > 0 && counts.AAAA > 0 && (await servedA()) > 0;
    }, { timeout: 60000, label: `the shaped node to ask its own server for A and AAAA, and the public servers for ${POLICY_HOST}` });
  });

  it('holds the signed bundle', async function () {
    this.timeout(150000);
    const db = dbClient(SHAPED + 1);
    await waitFor(async () => Boolean(await db.policyBundle()), {
      timeout: 120000, label: `the shaped node to hold the bundle served by ${POLICY_HOST}`,
    });
  });

  it(`sends its own server no AAAA query, and at most one probe per ${REPROBE_MS / 1000}s, over ${LOOKUPS} lookups`, async function () {
    this.timeout(150000);
    const before = await broken();
    const servedBefore = await servedA();
    const startedAt = Date.now();
    await waitFor(async () => (await servedA()) >= servedBefore + LOOKUPS, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} more lookups of ${POLICY_HOST}`,
    });
    const allowed = Math.floor((Date.now() - startedAt) / REPROBE_MS) + 1;
    const lookups = (await servedA()) - servedBefore;
    const after = await broken();
    expect(after.AAAA - before.AAAA, `AAAA queries to its own server over ${lookups} lookups`).to.equal(0);
    expect(after.A - before.A, `A queries (probes) to its own server over ${lookups} lookups`).to.be.at.most(allowed);
  });
});
