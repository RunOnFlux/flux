import { createHash, randomBytes } from 'node:crypto';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import {
  bootAndPeer, seedSpawnerApp, waitForInstanceCount,
} from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { appOwnerKey } from '../framework/keys.js';
import { signBtcMessage } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Region pins, end to end, on a fleet whose regions the location table actually
// carries.
//
// Suites 62-64 exercise the table at country and organisation granularity. This
// one exercises the rung below, where the rule is PROOF in both directions: a
// region pin in the table's own ISO 3166-2 vocabulary is satisfied only by a
// node whose table region is known and equal, and a region deny catches only
// such a node. A node the table places in the right COUNTRY but whose region it
// does not carry therefore satisfies no region pin and is caught by no region
// deny - it is neither promised nor banned on a geography nobody can prove.
//
// The stub's `regions: true` split is what makes that testable: organisation 0
// carries one region, organisation 1 another, and the last organisation carries
// none, so one fleet holds both kinds of node at once. Everything the suite
// pins with is read back from the stub's own answer rather than written into
// the assertions, so the artifact's vocabulary stays the stub's to change.
//
// Three claims, on one fleet:
//   - the candidate count scopes to the region, ignoring unknown-region nodes
//     even in the pinned country;
//   - registration REFUSES a region pin the same table proves nobody can serve,
//     while keeping the zero-candidate allowance for a spec that also carries a
//     country entry (there the miss is not a proof);
//   - the fleet converges the way the count says it will - in-region only, and
//     a deny that cannot be proven does not exclude.

const DOMAINS = 3;
const GATE_IMAGE = 'e2e-region-probe';

// The v8 spec shape the registration validator wants in full: it runs before
// the placement gate, so a hand-rolled spec fails on a missing field long
// before it proves anything about placement (suite 64's gateSpec, with the
// probe image and port this suite pushes).
function gateSpec({ name, instances = 3, geolocation = [] }) {
  return {
    version: 8,
    name,
    description: `region pin probe ${name}`,
    owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    compose: [{
      name: 'probe',
      description: 'probe component',
      repotag: `${REGISTRY_REPO_HOST}/${GATE_IMAGE}:v1`,
      ports: [31161],
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
}

// buildSeedableApp signs the spec it builds and takes no geolocation, so a
// placement-pinned seed has to be signed here. Same message construction as
// seed-helper's: type + version + spec + timestamp signed by the app owner,
// hashed with the signature appended, and the spec's own copy carries the hash
// and height the seeded collections are keyed on.
async function pinGeolocation(app, geolocation) {
  const ownerKey = appOwnerKey();
  const { height } = app.spec;
  // hash and height are appended AFTER signing, so strip them back off; the
  // remaining keys keep the order the signed JSON depends on
  const spec = { ...app.spec };
  delete spec.hash;
  delete spec.height;
  spec.geolocation = geolocation;
  const type = 'fluxappregister';
  const version = 1;
  const timestamp = Date.now();
  const signature = await signBtcMessage(type + version + JSON.stringify(spec) + timestamp, ownerKey.privkey);
  const messageHash = createHash('sha256')
    .update(type + version + JSON.stringify(spec) + timestamp + signature)
    .digest('hex');
  const txid = randomBytes(32).toString('hex');
  return {
    spec: { ...spec, hash: messageHash, height },
    permanentMessage: {
      type,
      version,
      appSpecifications: spec,
      hash: messageHash,
      timestamp,
      signature,
      txid,
      height,
      valueSat: 200000000,
    },
    hash: messageHash,
    txid,
  };
}

describe('placement honours region pins on proof from the shared table', function () {
  let env;
  let node;
  let continents; // the artifact's country -> continent map, as served
  let regionA; // organisation 0's region
  let regionB; // organisation 1's region
  let unprovableRegion; // in the vocabulary, belonging to the last organisation's country, claimed by no address
  let fleetContinent;
  const subnet = getSubnetConfig();

  // The stub splits a /24's addresses across organisations by last octet, so an
  // address's organisation is its last octet modulo the domain count - the same
  // arithmetic suite 63 asserts its spread with.
  const orgOf = (nodeIndex) => Number(subnet.nodeIp(nodeIndex + 1).split('.')[3]) % DOMAINS;
  const indicesInOrg = (org) => env.clients.map((unused, i) => i).filter((i) => orgOf(i) === org);
  const countryOf = (region) => region.slice(0, 2);
  const allowRegion = (region) => `ac${continents[countryOf(region)]}_${countryOf(region)}_${region}`;
  const denyRegion = (region) => `a!c${continents[countryOf(region)]}_${countryOf(region)}_${region}`;

  // verifyappregistrationspecifications is a legacy req.on('data') handler:
  // express.json() consumes the stream first when the request carries
  // application/json, so its 'end' never fires and the request hangs until the
  // test times out. Send it as text/plain, which leaves the body for the
  // handler to read.
  const verifyRegistration = (spec) => node.post(
    '/apps/verifyappregistrationspecifications',
    spec,
    { 'Content-Type': 'text/plain' },
  );

  dumpLogsOnFailure(() => env);

  before(async function () {
    // More than suite 63's before-hook budget because this one also waits for
    // every node to have INGESTED the table: an installer resolves its own
    // region through it, so a node still without it refuses a region-pinned app
    // and the convergence scenarios would race the ingest.
    this.timeout(420000);
    // Six nodes and suite 63's mesh, unchanged: six is what spans three
    // organisations on consecutive addresses from .10, and the thresholds below
    // are configured to the fleet rather than the fleet grown to the thresholds.
    env = await createTestEnv({ hookCtx: this, nodes: 6, tickerAutostart: false });

    // Three organisations WITH regions, published before the nodes boot so
    // their first fetch already carries them. Organisations 0 and 1 carry a
    // region; the last carries none.
    const response = await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: DOMAINS, subnet: subnet.base, regions: true }),
    });
    expect(response.ok, 'stub accepted the regioned split artifact').to.equal(true);
    const published = await response.json();

    // Everything this suite pins with comes from that answer. The stub's
    // country and region tables are index-aligned - regions[k] belongs to
    // countries[k], and the split gives organisation k country k - so the
    // region the LAST organisation would carry if it carried one is
    // table[DOMAINS - 1]: in the vocabulary, in a country two fleet nodes are
    // in, and claimed by no address. That is the pin nothing can prove.
    const { table, assigned, unassigned } = published.regions;
    regionA = assigned['0'];
    regionB = assigned['1'];
    unprovableRegion = table[DOMAINS - 1];
    expect(regionA, 'organisation 0 carries a region').to.be.a('string');
    expect(regionB, 'organisation 1 carries a region').to.be.a('string');
    expect(assigned[String(DOMAINS - 1)], 'the last organisation carries no region').to.equal(null);
    expect(unassigned, 'the last organisation\'s country region is claimed by no address').to.include(unprovableRegion);

    // the artifact's own country -> continent map, so the spec strings this
    // suite builds use the vocabulary the table was published with
    const stubState = await (await fetch(`${env.stubControl}/state`)).json();
    ({ continents } = stubState.ipLocation);
    const splitContinents = new Set(table.slice(0, DOMAINS).map((region) => continents[countryOf(region)]));
    expect(splitContinents.size, 'the split countries share one continent, so a continent allow admits the whole fleet').to.equal(1);
    [fleetContinent] = [...splitContinents];

    await bootAndPeer(env);
    await pushTestApp(GATE_IMAGE);
    [node] = env.clients;

    // A node answers placement questions from the table it has INGESTED, and
    // resolves its own region the same way. Wait until every node reports the
    // table available with every fleet address resolved - the state the
    // scenarios below assume - rather than assuming the first fetch landed.
    await waitFor(async () => {
      const trees = await Promise.all(env.clients.map(
        (client) => client.get('/apps/placementlocations').catch(() => null),
      ));
      return trees.every((tree) => tree?.status === 'success'
        && tree.data.tableAvailable === true
        && tree.data.total.nodes === env.nodeCount
        && tree.data.unresolved === 0);
    }, { timeout: 120000, interval: 3000, label: 'every node holds the location table with every fleet address resolved' });

    const tree = await node.get('/apps/placementlocations');
    expect(tree.data.total.domains, 'the fleet spans the published organisations').to.equal(DOMAINS);
  });

  after(async function () {
    this.timeout(30000);
    // leave the stub on its single-domain, region-less default for whatever
    // runs next
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await env?.teardown();
  });

  it('counts only nodes whose table region is the pinned one', async function () {
    this.timeout(60000);
    const inRegionA = indicesInOrg(0);
    const pinned = await node.post('/apps/placementfeasibility', {
      instances: inRegionA.length,
      geolocation: [allowRegion(regionA)],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(pinned.status).to.equal('success');
    expect(pinned.data.tableAvailable).to.equal(true);
    expect(pinned.data.normalizedGeolocation).to.deep.equal([allowRegion(regionA)]);
    expect(pinned.data.coarsenedEntries, 'a full ISO 3166-2 pin is honoured at region granularity').to.deep.equal([]);
    // exactly the organisation-0 nodes: the other organisations' nodes are in
    // other countries, and the last organisation's nodes carry no region at all
    expect(pinned.data.candidateCount).to.equal(inRegionA.length);
    expect(pinned.data.domainCount, 'the pinned region is one organisation').to.equal(1);
    expect(pinned.data.satisfiable).to.equal(true);
    // a synced app whose instances outnumber the fault domains it may use is
    // deliverable with less resiliency than the count implies
    expect(pinned.data.category).to.equal('constrained');

    // The v9 structured shape asks the same question and must get the same
    // answer, normalised to the same spec string - the deploy form passes one
    // object to this endpoint and to the spec it registers.
    const structured = await node.post('/apps/placementfeasibility', {
      instances: inRegionA.length,
      geoAllow: [{ continent: continents[countryOf(regionA)], country: countryOf(regionA), region: regionA }],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(structured.status).to.equal('success');
    expect(structured.data.normalizedGeolocation).to.deep.equal([allowRegion(regionA)]);
    expect(structured.data.candidateCount).to.equal(inRegionA.length);
    expect(structured.data.domainCount).to.equal(1);
    expect(structured.data.coarsenedEntries).to.deep.equal([]);

    // The same question for a region the vocabulary publishes, in a country the
    // fleet IS in, that no address claims: the nodes there have no provable
    // region, so none of them is a candidate. Nothing about the country - which
    // the table answers - is allowed to stand in for the region it cannot.
    const unprovable = await node.post('/apps/placementfeasibility', {
      instances: 1,
      geolocation: [allowRegion(unprovableRegion)],
      compose: [{ containerData: 'g:/data' }],
    });
    expect(unprovable.status).to.equal('success');
    expect(unprovable.data.candidateCount, `no node proves ${unprovableRegion}`).to.equal(0);
    expect(unprovable.data.category).to.equal('impossible');
  });

  it('refuses to register a region pin the table proves nobody can serve', async function () {
    this.timeout(60000);
    // Every allow entry is a region pin in the table's own vocabulary, and the
    // installer resolves its region through that same table - so zero
    // candidates is a proof, not a gap in the data, and the registration is
    // refused before it is paid for.
    const refused = await verifyRegistration(gateSpec({
      name: `regionreject${Date.now()}`,
      instances: 3,
      geolocation: [allowRegion(unprovableRegion)],
    }));
    expect(refused.status).to.equal('error');
    expect(refused.data.message).to.include('eligible nodes');
    expect(refused.data.message).to.include('Widen the allowed locations');

    // The same pin PLUS a country entry the table cannot resolve is accepted:
    // country eligibility is settled at install time by each node's own
    // self-report rather than by this table, so a total miss there is not a
    // proof and must not refuse. The refusal above is narrow on purpose, and
    // this is what keeps it narrow.
    const spareCountry = Object.keys(continents)
      .find((cc) => !regionA.startsWith(cc) && !regionB.startsWith(cc) && !unprovableRegion.startsWith(cc));
    expect(spareCountry, 'the artifact publishes a country no organisation is in').to.be.a('string');
    const accepted = await verifyRegistration(gateSpec({
      name: `regionmixed${Date.now()}`,
      instances: 3,
      geolocation: [allowRegion(unprovableRegion), `ac${continents[spareCountry]}_${spareCountry}`],
    }));
    expect(accepted.status).to.equal('success');
  });

  it('converges a region-pinned synced app onto in-region nodes only', async function () {
    this.timeout(200000);
    const inRegionA = indicesInOrg(0);
    const appName = `e2eregionpin${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31171], instances: inRegionA.length,
    });
    await seedSpawnerApp(env, await pinGeolocation(app, [allowRegion(regionA)]));

    // The pinned region holds exactly this many nodes, so convergence to the
    // requested count leaves no choice about WHICH nodes: the placed set must
    // be the region's own. waitForInstanceCount's stability window also fails
    // an out-of-region extra arriving late.
    const placed = await waitForInstanceCount(env, appName, inRegionA.length, { timeout: 150000, stableMs: 15000 });
    expect(placed, `expected the ${regionA} nodes ${inRegionA}, got ${placed}`).to.deep.equal(inRegionA);
  });

  it('applies a region deny only where the table proves the region', async function () {
    this.timeout(200000);
    const denied = indicesInOrg(1);
    const unknownRegionNodes = indicesInOrg(DOMAINS - 1);
    const appName = `e2eregiondeny${Date.now()}`;
    await pushTestApp(appName);
    const app = await buildSeedableSyncthingApp({
      name: appName, mode: 'g', ports: [31172], instances: 3,
    });
    // allowed across the whole fleet's continent, denied in organisation 1's
    // region. The continent is what leaves every organisation a candidate: the
    // split gives each of them a different country, so a country allow would
    // decide the outcome before the deny ever applied.
    await seedSpawnerApp(env, await pinGeolocation(app, [
      `ac${fleetContinent}`,
      denyRegion(regionB),
    ]));

    const placed = await waitForInstanceCount(env, appName, 3, { timeout: 150000, stableMs: 15000 });
    expect(placed.length).to.equal(3);
    expect(placed.filter((index) => denied.includes(index)), `${regionB} is denied`).to.deep.equal([]);
    // The remaining candidates are two organisations of two nodes against three
    // instances, so one instance must land on a node whose region the table
    // does not carry - the deny does not reach a region nobody can prove.
    expect(placed.some((index) => unknownRegionNodes.includes(index)),
      'an unknown-region node is not caught by the region deny').to.equal(true);
  });
});
