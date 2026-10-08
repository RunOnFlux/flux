import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A name a node's own DNS server never answers - its authoritative servers are dead -
// fails that lookup alone. The node goes on asking its own server for every other name.
//
// Anyone can make a node look such a name up: /apps/verifyappregistrationspecifications
// needs no authentication and resolves the registry host in the spec's repotag. The suite
// does exactly that, with a registry host the fleet's resolver never answers.
//
// Node 1 is built with the public-dns-counted shape (test-infra/network-shapes.sh): its own
// DNS server is the fleet's resolver, as on every node, and the public servers FluxOS asks
// next reach the same resolver on another port, so each answer is counted by the route the
// query took. The node's policy source is a host only it fetches, refreshed every few
// seconds, so the resolver's count of that host is the node's lookups of it, by route.

const POLICY_HOST = 'policy.e2e.test';
const DEAD_HOST = 'dead.e2e.test';
const NODES = 3;
const SHAPED = 0;
const LOOKUPS = 3;

describe('a name its own DNS server never answers leaves a node using that server', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const via = async (name) => (await dnsRecordsServed())[name]?.via ?? {};
  const policyA = async () => {
    const counts = await via(POLICY_HOST);
    return { own: counts.own?.A ?? 0, public: counts.public?.A ?? 0 };
  };

  // verifyappregistrationspecifications is a legacy req.on('data') handler: it reads the body
  // itself, so the spec goes as text/plain (see suite 64).
  const verifyRegistration = (spec) => env.clients[SHAPED].post(
    '/apps/verifyappregistrationspecifications',
    spec,
    { 'Content-Type': 'text/plain' },
  );

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'public-dns-counted' },
      dnsRecords: [
        { name: POLICY_HOST, records: { A: getSubnetConfig().externalStub } },
        { name: DEAD_HOST, records: { A: 'NO_REPLY', AAAA: 'NO_REPLY' } },
      ],
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

  it('looks the policy host up through its own DNS server', async function () {
    // The route under test, shown working before the dead name is looked up.
    this.timeout(90000);
    await waitFor(async () => (await policyA()).own > 0, {
      timeout: 60000, label: `the shaped node to look ${POLICY_HOST} up through its own server`,
    });
    expect((await policyA()).public).to.equal(0);
  });

  it('asks its own DNS server for the dead name when a registration names it', async function () {
    // The condition under test, shown present: the node really asked for the name.
    this.timeout(90000);
    verifyRegistration({
      version: 8,
      name: `e2edeadname${Date.now()}`,
      description: 'a registry host its DNS server never answers',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      compose: [{
        name: 'web',
        description: 'web',
        repotag: `${DEAD_HOST}/app:v1`,
        ports: [31801],
        containerPorts: [80],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerData: '/data',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        tiered: false,
        secrets: '',
        repoauth: '',
      }],
      instances: 3,
      contacts: [],
      geolocation: [],
      expire: 22000,
      nodes: [],
      staticip: false,
      enterprise: '',
    }).catch(() => null);
    await waitFor(async () => ((await via(DEAD_HOST)).own?.A ?? 0) > 0, {
      timeout: 60000, label: `the shaped node to ask its own server for ${DEAD_HOST}`,
    });
  });

  it(`keeps looking the policy host up through its own DNS server over ${LOOKUPS} more lookups`, async function () {
    this.timeout(150000);
    const before = await policyA();
    await waitFor(async () => (await policyA()).own >= before.own + LOOKUPS || (await policyA()).public > before.public, {
      timeout: 120000, interval: 1000, label: `${LOOKUPS} more lookups of ${POLICY_HOST}`,
    });
    const after = await policyA();
    expect(after.public - before.public, `lookups of ${POLICY_HOST} through the public servers`).to.equal(0);
    expect(after.own - before.own).to.be.at.least(LOOKUPS);
  });
});
