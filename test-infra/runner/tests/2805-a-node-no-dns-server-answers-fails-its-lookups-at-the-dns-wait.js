import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node no DNS server answers - neither its own nor the public ones - fails each lookup with
// the DNS error once the public servers' wait is over, and does not ask its own server again
// through the operating system's resolver.
//
// Node 1 is built with the all-dns-silent shape (test-infra/network-shapes.sh): its own DNS
// server and the public servers FluxOS asks next are addresses nothing holds, and a counting
// rule for each counts the queries the node sends there.
//
// The node's policy source is a host only it fetches, refreshed every few seconds, so its
// lookups of that host come at a steady rate and each one fails. Each lookup sends the public
// servers at least one A query; the node holds no IPv6 address, so it asks for no AAAA records. The first lookup asks the silent own server and probes it once
// (dnsLookup.js); after that the server is skipped and probed again at most once every
// REPROBE_MS, so over a window of lookups it is sent at most one query per REPROBE_MS begun. A
// lookup that ended in getaddrinfo would send the own server that lookup's queries again.

const POLICY_HOST = 'policy.e2e.test';
const NODES = 3;
const SHAPED = 0;
const OWN_SERVER = '192.0.2.1';
const PUBLIC_SERVERS = '192.0.2.2';
const REPROBE_MS = 30000;
const LOOKUPS = 3;
// At least one A query for each lookup.
const PUBLIC_QUERIES_PER_LOOKUP = 1;

describe('a node no DNS server answers fails its lookups at the DNS wait', function () {
  let env;

  dumpLogsOnFailure(() => env);

  // Queries the shaped node has sent to an address, by the shape's counting rule.
  const queriesTo = async (address) => {
    const { stdout } = await execInContainer(env.clients[SHAPED].container, 'iptables -L OUTPUT -v -x -n');
    const line = stdout.split('\n').find((l) => l.includes(address) && l.includes('dpt:53'));
    if (!line) throw new Error(`no counting rule for ${address}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'all-dns-silent' },
      nodeConfigOverrides: {
        [SHAPED]: { policy: { signedBaseUrl: `http://${POLICY_HOST}:3000`, refreshIntervalMs: 15000 } },
      },
      // The shaped node can resolve no name, so it never obtains policy.
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('asks its own DNS server and the public servers', async function () {
    // The condition under test, shown present.
    this.timeout(90000);
    await waitFor(async () => (await queriesTo(OWN_SERVER)) > 0 && (await queriesTo(PUBLIC_SERVERS)) > 0, {
      timeout: 60000, label: `the shaped node to ask ${OWN_SERVER} and the public servers`,
    });
  });

  it('fails the policy host\'s lookup with the DNS error, not the operating system resolver\'s', async function () {
    this.timeout(90000);
    const fromDns = new RegExp(`backstop fetch failed: query[A-Za-z]* ETIMEOUT ${POLICY_HOST}`);
    await waitFor(async () => env.nodeHasLog(SHAPED, fromDns), {
      timeout: 60000, label: `a policy fetch to fail with ETIMEOUT for ${POLICY_HOST}`,
    });
    const fromOs = new RegExp(`backstop fetch failed: getaddrinfo .*${POLICY_HOST}`);
    expect(env.nodeHasLog(SHAPED, fromOs), 'a policy fetch failed by the operating system resolver').to.equal(false);
  });

  it(`sends its own server at most one probe per ${REPROBE_MS / 1000}s over ${LOOKUPS} failed lookups`, async function () {
    this.timeout(150000);
    const ownBefore = await queriesTo(OWN_SERVER);
    const publicBefore = await queriesTo(PUBLIC_SERVERS);
    const startedAt = Date.now();
    await waitFor(async () => (await queriesTo(PUBLIC_SERVERS)) >= publicBefore + LOOKUPS * PUBLIC_QUERIES_PER_LOOKUP, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} more lookups through the public servers`,
    });
    const allowed = Math.floor((Date.now() - startedAt) / REPROBE_MS) + 1;
    const own = (await queriesTo(OWN_SERVER)) - ownBefore;
    expect(own, `${own} queries to ${OWN_SERVER} over ${LOOKUPS} or more failed lookups`).to.be.at.most(allowed);
  });
});
