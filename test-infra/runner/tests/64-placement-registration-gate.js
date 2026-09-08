import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer, waitForLocationTable } from '../framework/reconciler-suite.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { assignPorts } from '../framework/port-allocator.js';
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

const APP_IMAGE = 'e2e-gate-probe';

// The v8 spec shape the harness seeds with (seed-helper.buildSeedableApp): the
// registration validator runs in full before the placement gate is reached, so
// a hand-rolled spec fails on a missing field long before it proves anything
// about placement.
function gateSpec({ name, instances = 3, geolocation = [] }) {
  const spec = {
    version: 8,
    name,
    description: `placement gate probe ${name}`,
    owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    compose: [{
      name: 'probe',
      description: 'probe component',
      repotag: `${REGISTRY_REPO_HOST}/${APP_IMAGE}:v1`,
      ports: [],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: 'g:/appdata',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    }],
    instances,
    contacts: [],
    geolocation,
    expire: 22000,
    nodes: [],
    staticip: false,
    enterprise: '',
  };

  // Hand-rolled rather than built, so it goes to the allocator itself -
  // the one place a seeded port comes from. Stable per app name, so every
  // spec built for one app here carries the same port.
  assignPorts(spec.compose, name);
  return spec;
}

describe('placement gate at registration and the advice endpoint', function () {
  let env;
  let node;

  // verifyappregistrationspecifications is a legacy req.on('data') handler:
  // express.json() consumes the stream first when the request carries
  // application/json, so its 'end' never fires and the request hangs until the
  // test times out. Send it as text/plain, which is what leaves the body for
  // the handler to read.
  const verifyRegistration = (spec) => node.post(
    '/apps/verifyappregistrationspecifications',
    spec,
    { 'Content-Type': 'text/plain' },
  );
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(360000);
    // A four-node fleet is all this suite needs - it asks the API questions,
    // it does not place anything. The shared mesh minimums are sized for the
    // ten-node spawner suites, so lower them to what four nodes can satisfy
    // rather than paying for six idle nodes.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      tickerAutostart: false,
      // minOutgoing is BOTH the app-submission door and the number of outgoing
      // connections each node establishes (fluxCommunication.js's
      // minDeterministicOutPeers), so the fleet, this value and the peer wait
      // below all have to agree.
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1 } },
    });
    await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 3, subnet: getSubnetConfig().base }),
    });
    // The deterministic ring has node i dial i+1..i+minOutgoing, and mutual
    // pairs are de-duplicated, so in a four-node fleet node 0 settles at one
    // outbound and two inbound - the split is an artefact of the ring size, not
    // something this suite depends on. It needs a peered, healthy node to ask
    // questions of, so it waits for one connection in each direction.
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // the repotag must exist in the harness registry: registration verifies it
    // before it ever reaches the placement gate, and a Docker Hub tag has
    // nowhere to resolve from inside the fleet's internal network
    await pushTestApp(APP_IMAGE);
    [node] = env.clients;
    // .10 .11 .12 .13 round-robin across three organisations - the first
    // advice request must not race the boot ingest of the padded artifact
    await waitForLocationTable(node, { domains: 3 });
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
    }, { zelidauth: node.zelidauth });
    expect(response.status).to.equal('success');
    expect(response.data.tableAvailable, 'nodes fetched and parsed the artifact').to.equal(true);
    // .10 .11 .12 .13 round-robin across three organisations
    expect(response.data.domainCount).to.equal(3);
    expect(response.data.candidateCount).to.equal(4);
    expect(response.data.category).to.equal('ok');
  });

  it('reports a constrained placement when instances outnumber domains', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/placementfeasibility', {
      instances: 4,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    }, { zelidauth: node.zelidauth });
    expect(response.data.category).to.equal('constrained');
    expect(response.data.satisfiable).to.equal(true);
    expect(response.data.maxPerDomain).to.be.greaterThan(1);
  });

  it('reports an impossible placement when the count exceeds the eligible pool', async function () {
    this.timeout(60000);
    const response = await node.post('/apps/placementfeasibility', {
      instances: 6,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    }, { zelidauth: node.zelidauth });
    expect(response.data.category).to.equal('impossible');
    expect(response.data.satisfiable).to.equal(false);
  });

  it('serves the placement geography tree', async function () {
    this.timeout(60000);
    const response = await node.get('/apps/placementlocations');
    expect(response.status).to.equal('success');
    expect(response.data.tableAvailable).to.equal(true);
    expect(response.data.total.nodes).to.equal(4);
    expect(response.data.total.domains).to.equal(3);
    expect(response.data.unresolved, 'the table resolves every harness node').to.equal(0);
  });

  it('refuses a registration whose instance count the network provably cannot meet', async function () {
    this.timeout(60000);
    const response = await verifyRegistration(gateSpec({
      name: `gatereject${Date.now()}`,
      instances: 6, // four eligible nodes exist
    }));
    expect(response.status).to.equal('error');
    expect(response.data.message).to.include('eligible nodes');
    expect(response.data.message).to.include('Widen the allowed locations');
  });

  it('accepts a registration the network can satisfy', async function () {
    this.timeout(60000);
    const response = await verifyRegistration(gateSpec({
      name: `gateaccept${Date.now()}`,
      instances: 3,
    }));
    expect(response.status).to.equal('success');
  });

  it('accepts a geography the table cannot resolve rather than proving it impossible', async function () {
    this.timeout(60000);
    // no harness node resolves to Bahrain, so the shortfall is total - which is
    // indistinguishable from the table mis-attributing that country, and the
    // gate must not refuse on it
    const response = await verifyRegistration(gateSpec({
      name: `gateunknown${Date.now()}`,
      instances: 3,
      geolocation: ['acAS_BH'],
    }));
    expect(response.status).to.equal('success');
  });
});
