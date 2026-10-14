import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node with no IPv6 address but loopback and link-local asks for a host's A records only,
// as getaddrinfo does for net.connect's dns.ADDRCONFIG; a node with a global IPv6 address asks
// for both.
//
// Node 1 holds no IPv6 address, as a harness node does by default; node 2 is given a global one
// (createTestEnv globalIpv6). Each fetches its policy from a host of its own, refreshed every
// few seconds, so the resolver's count of each host's queries is that node's lookups of it.
// Both hosts have A and AAAA records.
//
// Node 2's AAAA queries show the resolver counts that record type for these hosts.

const NO_IPV6 = 0;
const WITH_IPV6 = 1;
const NODES = 3;
const HOST = { [NO_IPV6]: 'policy-v4only.e2e.test', [WITH_IPV6]: 'policy-dualstack.e2e.test' };
const LOOKUPS = 3;

describe('a node with no IPv6 address asks for no AAAA records', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const served = async (node) => (await dnsRecordsServed())[HOST[node]]?.served ?? {};

  before(async function () {
    this.timeout(420000);
    const records = { A: getSubnetConfig().externalStub, AAAA: '2001:db8:5::1' };
    const policyFrom = (host) => ({ policy: { signedBaseUrl: `http://${host}:3000`, refreshIntervalMs: 15000 } });
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      globalIpv6: [WITH_IPV6],
      dnsRecords: [{ name: HOST[NO_IPV6], records }, { name: HOST[WITH_IPV6], records }],
      nodeConfigOverrides: {
        [NO_IPV6]: policyFrom(HOST[NO_IPV6]),
        [WITH_IPV6]: policyFrom(HOST[WITH_IPV6]),
      },
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks for both record types from the node with a global IPv6 address', async function () {
    // Canary for the zero below.
    this.timeout(90000);
    await waitFor(async () => {
      const counts = await served(WITH_IPV6);
      return counts.A > 0 && counts.AAAA > 0;
    }, { timeout: 60000, label: `node ${WITH_IPV6 + 1} to ask for ${HOST[WITH_IPV6]}'s A and AAAA records` });
  });

  it(`asks for A records only, over ${LOOKUPS} lookups, from the node with no IPv6 address`, async function () {
    this.timeout(150000);
    await waitFor(async () => ((await served(NO_IPV6)).A ?? 0) >= LOOKUPS, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} lookups of ${HOST[NO_IPV6]}`,
    });
    expect((await served(NO_IPV6)).AAAA ?? 0, `AAAA queries for ${HOST[NO_IPV6]}`).to.equal(0);
  });
});
