import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The registration front door and the placement advice endpoint, against a
// fleet whose geography the location table actually describes.
//
// Nothing in the harness covered either before: a spec the network provably
// cannot satisfy used to be accepted and paid for, and the advice endpoint is
// the number a deploy form shows before payment. Both are decided by the same
// computation the spawner uses, so this suite is what keeps the three from
// drifting apart in the field.
//
// The gate's rule is narrow on purpose and asserted here in both directions:
// a shortfall it can PROVE is refused, and everything it cannot prove is
// allowed through - an unresolvable geography, a missing table, a spec whose
// count the network can meet.

const SIGNED_SPEC_BASE = {
  version: 7,
  name: 'placementgateprobe',
  description: 'placement gate probe',
  owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  compose: [{
    name: 'probe',
    description: 'probe component',
    repotag: 'runonflux/website:latest',
    ports: [31151],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [8080],
    containerData: 'g:/data',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    tiered: false,
  }],
  instances: 3,
  contacts: [],
  geolocation: [],
  expire: 22000,
  nodes: [],
  staticip: false,
};

describe('placement gate at registration and the advice endpoint', function () {
  let env;
  let node;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(360000);
    // 10 nodes: the shared mesh minimums (minOutgoing 4 / minIncoming 2) are
    // not satisfiable by a smaller fleet, so peering never completes
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 3, subnet: getSubnetConfig().base }),
    });
    await bootAndPeer(env);
    [node] = env.clients;
  });

  after(async function () {
    this.timeout(30000);
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await env?.teardown();
  });

  it('answers the advice endpoint from the served table', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/placementfeasibility', {
      instances: 3,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(response.status).to.equal('success');
    expect(response.data.tableAvailable, 'nodes fetched and parsed the artifact').to.equal(true);
    // three organisations across a ten-node fleet
    expect(response.data.domainCount).to.equal(3);
    expect(response.data.candidateCount).to.equal(10);
    expect(response.data.category).to.equal('ok');
  });

  it('reports a constrained placement when instances outnumber domains', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/placementfeasibility', {
      instances: 4,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(response.data.category).to.equal('constrained');
    expect(response.data.satisfiable).to.equal(true);
    expect(response.data.maxPerDomain).to.be.greaterThan(1);
  });

  it('reports an impossible placement when the count exceeds the eligible pool', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/placementfeasibility', {
      instances: 12,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(response.data.category).to.equal('impossible');
    expect(response.data.satisfiable).to.equal(false);
  });

  it('serves the placement geography tree', async function () {
    this.timeout(60000);
    const response = await node.get('/apps/placementlocations');
    expect(response.status).to.equal('success');
    expect(response.data.tableAvailable).to.equal(true);
    expect(response.data.total.nodes).to.equal(10);
    expect(response.data.total.domains).to.equal(3);
    expect(response.data.unresolved, 'the table resolves every harness node').to.equal(0);
  });

  it('refuses a registration whose instance count the network provably cannot meet', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/verifyappregistrationspecifications', {
      ...SIGNED_SPEC_BASE,
      name: `gatereject${Date.now()}`,
      instances: 12, // ten eligible nodes exist
    });
    expect(response.status).to.equal('error');
    expect(response.data.message).to.include('eligible nodes');
    expect(response.data.message).to.include('Widen the allowed locations');
  });

  it('accepts a registration the network can satisfy', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/verifyappregistrationspecifications', {
      ...SIGNED_SPEC_BASE,
      name: `gateaccept${Date.now()}`,
      instances: 3,
    });
    expect(response.status).to.equal('success');
  });

  it('accepts a geography the table cannot resolve rather than proving it impossible', async function () {
    this.timeout(60000);
    // no harness node resolves to Bahrain, so the shortfall is total - which is
    // indistinguishable from the table mis-attributing that country, and the
    // gate must not refuse on it
    const response = await node.post('/apps/verifyappregistrationspecifications', {
      ...SIGNED_SPEC_BASE,
      name: `gateunknown${Date.now()}`,
      instances: 3,
      geolocation: ['acAS_BH'],
    });
    expect(response.status).to.equal('success');
  });
});
