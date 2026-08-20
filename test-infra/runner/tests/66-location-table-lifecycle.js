import { createHash, randomBytes } from 'node:crypto';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { appOwnerKey } from '../framework/keys.js';
import { signBtcMessage } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The location table's LIFE, as opposed to its first fetch.
//
// The domain-share, domain-split, registration-gate and region-pin suites all
// start from one healthy publication and ask what placement does with it.
// Everything here is about what happens afterwards, which is where
// a node spends every day of its life: it restarts, the publisher republishes,
// and some of those publications are bad. The contract in every one of those
// cases is the same sentence - a node keeps serving the last table it accepted -
// and nothing in the harness proved it until now.
//
// Five claims, each driven the way production reaches it:
//   - a restart ADOPTS the ingested table instead of re-ingesting it (the marker
//     names the baseline the collection already holds) and its refresh is a
//     conditional request, so an unchanged artifact costs a 304 and no body;
//   - a malformed publication is REJECTED AND THE PREVIOUS TABLE KEPT;
//   - so is a structurally valid but truncated one, on the row floor alone;
//   - so is the artifact vanishing entirely - absence never un-ingests;
//   - and an expire-only update (a renewal, a cancellation) is NEVER refused by
//     the placement gate, even when the table has since made the app's
//     geography impossible, while an update that does change placement still is.
//
// The refresh is daily and a suite cannot wait a day for it, so every scenario
// drives the same path production drives on a restart: restartFluxos kills only
// the FluxOS process, leaving mongo, the row collection and the artifact cache
// exactly where the node left them. That is the honest trigger - it is the
// `systemctl restart fluxos` a node operator performs - and it exercises adopt,
// conditional refresh and rejection in one go.
//
// What each node did about each publication is read from the stub's own fetch
// counters (GET /state -> ipLocationFetches, zeroed by every publication)
// rather than inferred from node logs: "this node never downloaded the artifact
// again" is a statement about the wire, so the wire is what answers it.

const NODES = 4;
// .10 .11 .12 .13 round-robin across three organisations, so the fleet spans
// three fault domains and three countries - all European (see the tree assert).
const BASELINE_DOMAINS = 3;
// A DIFFERENT split for the truncated publication, so "kept the previous table"
// and "installed the new one" are distinguishable in the numbers rather than
// only in the logs.
const BELOW_FLOOR_DOMAINS = 2;
// Splitting seven ways moves one fleet address into the artifact's non-European
// country, which is what turns a satisfiable continent pin into an impossible
// one without touching the app's spec.
const NARROWED_DOMAINS = 7;
// The store's truncation floor. A fleet-integrity invariant, deliberately not
// configuration - mirrored here because a fixture below is built to sit under it.
const TRUNCATION_FLOOR = 1500000;
const APP_IMAGE = 'e2e-lifecycle-probe';
const BINARY_ROUTE = '/iplocation.bin.gz';
const JSON_ROUTE = '/iplocation.json';

// Node 0 answers every question and is left alone until the last scenario; the
// others each take one restart, so no scenario inherits another's fresh process.
const QUERY_NODE = 0;
const REFRESH_NODE = 1;
const REJECT_NODE = 2;
const FLOOR_NODE = 3;

// The v8 spec shape the registration validator wants in full: it runs before the
// placement gate, so a hand-rolled spec fails on a missing field long before it
// proves anything about placement (the registration-gate suite's gateSpec, with
// this suite's probe image, port and owner).
function gateSpec({ name, instances, geolocation = [] }) {
  return {
    version: 8,
    name,
    description: `location table lifecycle probe ${name}`,
    owner: appOwnerKey().zelid,
    compose: [{
      name: 'probe',
      description: 'probe component',
      repotag: `${REGISTRY_REPO_HOST}/${APP_IMAGE}:v1`,
      ports: [31181],
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

// The permanent registration message an update is validated against. The update
// path resolves the app's PREVIOUS specifications out of the message collection,
// so an app the network has never heard of cannot be updated at all. Built the
// way the network builds it (seed-helper's construction): the owner signs
// type + version + spec + timestamp, and the message hash covers that plus the
// signature.
async function permanentRegistrationMessage(spec, height) {
  const ownerKey = appOwnerKey();
  const type = 'fluxappregister';
  const version = 1;
  const timestamp = Date.now();
  const signature = await signBtcMessage(type + version + JSON.stringify(spec) + timestamp, ownerKey.privkey);
  const hash = createHash('sha256')
    .update(type + version + JSON.stringify(spec) + timestamp + signature)
    .digest('hex');
  return {
    type,
    version,
    appSpecifications: spec,
    hash,
    timestamp,
    signature,
    txid: randomBytes(32).toString('hex'),
    height,
    valueSat: 200000000,
  };
}

describe('the location table survives restarts and refuses bad publications', function () {
  let env;
  let baselineGenerated; // the artifact identity every node ingests at boot
  let fleetContinent; // the continent the baseline split puts the whole fleet in
  let registeredSpec; // the formatted spec seeded as the app's previous version
  let instanceCount; // the app's instance count: the whole fleet
  const subnet = getSubnetConfig();
  const appName = `e2elifecycle${Date.now()}`;

  dumpLogsOnFailure(() => env);

  // Both verify endpoints are legacy req.on('data') handlers: express.json()
  // consumes the stream first when the request carries application/json, so
  // their 'end' never fires and the request hangs until the test times out. Send
  // them as text/plain, which leaves the body for the handler to read.
  const verifyRegistration = (spec) => env.clients[QUERY_NODE].post(
    '/apps/verifyappregistrationspecifications', spec, { 'Content-Type': 'text/plain' },
  );
  const verifyUpdate = (spec) => env.clients[QUERY_NODE].post(
    '/apps/verifyappupdatespecifications', spec, { 'Content-Type': 'text/plain' },
  );

  const stubState = async () => (await fetch(`${env.stubControl}/state`)).json();

  // What the fleet did about the artifact currently published. Publishing zeroes
  // these, so they are always scoped to the publication under test.
  const fetchCounts = async (route = BINARY_ROUTE) => (await stubState()).ipLocationFetches[route];

  const publish = async (body) => {
    const response = await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, 'the stub accepted the publication').to.equal(true);
    return response.json();
  };

  // The placement geography tree, or null while the node has no table: the
  // endpoint answers 503 without one and only SUCCESSES are cached, so polling
  // it is the honest "is this node serving from a table yet" gate after a
  // restart, and its body carries the table's identity as well as its shape.
  const locationsTree = async (client) => {
    const tree = await client.get('/apps/placementlocations').catch(() => null);
    return tree?.status === 'success' ? tree.data : null;
  };

  // The advice endpoint memoises identical questions for 30 seconds, so every
  // spot check below asks with its OWN instance count: a question a node has not
  // been asked before is always computed against the table it holds RIGHT NOW,
  // which is the entire point of asking it after a restart. The numbers read
  // here - candidateCount, domainCount, tableAvailable, tableGenerated - do not
  // depend on the count asked about.
  const tableAnswer = async (client, instances) => {
    const response = await client.post('/apps/placementfeasibility', {
      instances,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    }, { zelidauth: client.zelidauth });
    expect(response.status, JSON.stringify(response.data)).to.equal('success');
    return response.data;
  };

  // Restart only the FluxOS process and wait until it is serving placement
  // answers again. The container, its mongo databases and its artifact cache all
  // survive, so the fresh process redoes exactly the startup a node does after
  // `systemctl restart fluxos`: adopt what is stored, then refresh conditionally.
  const restartAndSettle = async (index, { generated = null, timeout = 240000 } = {}) => {
    await restartFluxos(env.clients[index].container);
    await waitFor(async () => {
      const tree = await locationsTree(env.clients[index]);
      if (!tree) return false;
      // a node that ingested a NEW baseline has also re-derived every node
      // location from it, so the wait covers both halves of that swap
      return generated ? tree.tableGenerated === generated && tree.unresolved === 0 : true;
    }, {
      timeout,
      interval: 3000,
      label: `node ${index} serves placement answers again${generated ? ' from the new baseline' : ''}`,
    });
  };

  before(async function () {
    this.timeout(420000);
    // Four nodes: this suite asks the API questions and restarts nodes, it
    // places nothing, so it is sized like the registration-gate suite rather than the convergence
    // suites. The shared mesh minimums are sized for the ten-node spawner
    // suites, so lower them to what four nodes can satisfy rather than paying
    // for idle nodes.
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1 } },
    });
    // Published before the fleet's table fetch (which waits on the app database
    // being rebuilt, i.e. well into bootAndPeer below), so every node's first
    // fetch is of THIS artifact and the counters it zeroes describe the boot.
    await publish({ domains: BASELINE_DOMAINS, subnet: subnet.base });
    baselineGenerated = (await stubState()).ipLocation.generated;

    // In a four-node ring with minOutgoing 2, mutual pairs de-duplicate down to
    // one outbound on some nodes - an artefact of the ring size, not something
    // this suite depends on. It needs peered, healthy nodes to ask questions of.
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // the repotag must exist in the harness registry: registration verifies it
    // before it ever reaches the placement gate, and a Docker Hub tag has
    // nowhere to resolve from inside the fleet's internal network
    await pushTestApp(APP_IMAGE);
    instanceCount = env.nodeCount;

    // Every node holds the published baseline with every fleet address resolved
    // before any scenario runs - the state the whole suite measures deviations
    // from. The fetch counters are the second half of the same gate: a node that
    // fetched something before the publication above would be holding another
    // artifact, and this is where that shows up.
    await waitFor(async () => {
      const trees = await Promise.all(env.clients.map(locationsTree));
      return trees.every((tree) => tree
        && tree.tableGenerated === baselineGenerated
        && tree.total.nodes === env.nodeCount
        && tree.unresolved === 0);
    }, { timeout: 240000, interval: 3000, label: 'every node holds the published baseline' });
    await waitFor(async () => (await fetchCounts()).ok >= env.nodeCount, {
      timeout: 60000, interval: 2000, label: 'every node downloaded the published baseline',
    });

    // The continent the baseline puts the fleet in, read off the served table so
    // the spec strings below use the vocabulary the artifact was published with.
    const tree = await locationsTree(env.clients[QUERY_NODE]);
    [fleetContinent] = Object.keys(tree.continents);
  });

  after(async function () {
    this.timeout(30000);
    // leave the stub on its single-domain default for whatever runs next
    await fetch(`${env?.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: 1 }),
    }).catch(() => {});
    await env?.teardown();
  });

  it('ingests the published baseline at boot, once per node', async function () {
    this.timeout(60000);
    const counts = await fetchCounts();
    expect(counts.ok, 'every node downloaded the artifact').to.equal(env.nodeCount);
    expect(counts.total, 'and none of them fetched it twice').to.equal(env.nodeCount);
    expect(counts.notModified, 'a first fetch has no etag to be conditional about').to.equal(0);
    expect(counts.missing).to.equal(0);
    expect((await fetchCounts(JSON_ROUTE)).total,
      'this fleet reads the binary representation only').to.equal(0);

    const trees = await Promise.all(env.clients.map(locationsTree));
    trees.forEach((tree, index) => {
      expect(tree, `node ${index} serves the placement geography`).to.not.equal(null);
      expect(tree.tableAvailable, `node ${index} holds a table`).to.equal(true);
      expect(tree.tableGenerated, `node ${index} holds the published baseline`).to.equal(baselineGenerated);
      expect(tree.total.nodes).to.equal(env.nodeCount);
      expect(tree.total.domains, 'the published split').to.equal(BASELINE_DOMAINS);
      expect(tree.unresolved, 'the table resolves every fleet address').to.equal(0);
      expect(Object.keys(tree.continents).length,
        'the baseline split keeps the whole fleet on one continent').to.equal(1);
      expect(tree.continents[fleetContinent].nodes).to.equal(env.nodeCount);
      expect(env.nodeLogCount(index, /ipLocationStore - baseline installed/),
        `node ${index} ingested the baseline exactly once`).to.equal(1);
    });
  });

  it('adopts the stored baseline across a FluxOS restart, without downloading or ingesting it again', async function () {
    this.timeout(300000);
    const beforeRestart = await fetchCounts();
    expect(env.nodeLogCount(REFRESH_NODE, /ipLocationStore - baseline installed/),
      'the node ingested the baseline exactly once, at boot').to.equal(1);

    await restartAndSettle(REFRESH_NODE);

    // The ingest marker names the baseline the row collection already holds, so
    // the fresh process serves it without walking two million rows to arrive
    // back where it started. Awaited rather than asserted: the node answers HTTP
    // over a shorter pipeline than its logs travel.
    await waitFor(() => env.nodeHasLog(REFRESH_NODE, /ipLocationStore - adopted the stored baseline/), {
      timeout: 30000, interval: 500, label: 'the restarted node adopted what it already had',
    });

    const tree = await locationsTree(env.clients[REFRESH_NODE]);
    expect(tree.tableGenerated, 'the same baseline as before the restart').to.equal(baselineGenerated);
    expect(tree.total.domains).to.equal(BASELINE_DOMAINS);
    expect(tree.unresolved).to.equal(0);

    // The refresh still runs on every startup; with the artifact unchanged the
    // etag makes it a conditional request that transfers no body at all.
    await waitFor(async () => (await fetchCounts()).notModified > beforeRestart.notModified, {
      timeout: 180000, interval: 2000, label: 'the restarted node revalidates its copy',
    });
    const afterRestart = await fetchCounts();
    expect(afterRestart.ok, 'and never downloads the artifact a second time').to.equal(beforeRestart.ok);
    // asserted after the revalidation: a 304 returns before any ingest could
    // start, so from here the restart is finished with the table for good
    expect(env.nodeLogCount(REFRESH_NODE, /ipLocationStore - baseline installed/),
      'and ingested nothing a second time').to.equal(1);
  });

  it('keeps the table it has when the publisher serves a malformed artifact', async function () {
    this.timeout(300000);
    // Bytes that fetch cleanly and are not an artifact: the reader throws on
    // them, and the contract is that the caller keeps what it already had.
    const published = await publish({
      artifact: { format: 1, generated: 'harness-malformed', v4: 'not-a-range-list' },
    });
    expect(published.rowCount, 'these bytes are not a format-2 artifact at all').to.equal(null);

    await restartAndSettle(REJECT_NODE);
    await waitFor(async () => (await fetchCounts()).ok >= 1, {
      timeout: 180000, interval: 2000, label: 'the restarted node downloads the malformed artifact',
    });
    // it kept its table because it REFUSED these bytes, not because it never saw them
    await waitFor(() => env.nodeHasLog(REJECT_NODE, /ipLocationSync - failed to refresh.*keeping current table/), {
      timeout: 30000, interval: 1000, label: 'the malformed artifact is refused',
    });

    const answer = await tableAnswer(env.clients[REJECT_NODE], 2);
    expect(answer.tableAvailable, 'the node still has a table').to.equal(true);
    expect(answer.tableGenerated, 'still the baseline it ingested at boot').to.equal(baselineGenerated);
    expect(answer.domainCount, 'and still that baseline\'s fault domains').to.equal(BASELINE_DOMAINS);
    expect(answer.candidateCount).to.equal(env.nodeCount);
    expect(env.nodeLogCount(REJECT_NODE, /ipLocationStore - baseline installed/),
      'nothing was ingested over the good table').to.equal(1);
  });

  it('refuses a truncated baseline on the row floor and keeps the one it has', async function () {
    this.timeout(300000);
    // A structurally perfect artifact carrying only the fleet's own rows. Every
    // other publication in the harness is padded to real scale precisely so it
    // clears the floor; this one is floor bait by design, and the split it
    // describes differs from the baseline's so an accidental ingest would show
    // up in the numbers rather than only in a log line.
    const published = await publish({
      domains: BELOW_FLOOR_DOMAINS, subnet: subnet.base, pad: false,
    });
    expect(published.padded).to.equal(false);
    expect(published.rowCount, 'the artifact sits below the truncation floor').to.be.lessThan(TRUNCATION_FLOOR);

    await restartAndSettle(FLOOR_NODE);
    await waitFor(async () => (await fetchCounts()).ok >= 1, {
      timeout: 180000, interval: 2000, label: 'the restarted node downloads the truncated artifact',
    });
    await waitFor(() => env.nodeHasLog(FLOOR_NODE, /below the truncation floor/), {
      timeout: 30000, interval: 1000, label: 'the truncated artifact is refused on the floor',
    });

    const answer = await tableAnswer(env.clients[FLOOR_NODE], 3);
    expect(answer.tableAvailable).to.equal(true);
    expect(answer.tableGenerated, 'still the baseline it ingested at boot').to.equal(baselineGenerated);
    expect(answer.domainCount, `the original split, not the truncated artifact's ${BELOW_FLOOR_DOMAINS}`)
      .to.equal(BASELINE_DOMAINS);
    expect(env.nodeLogCount(FLOOR_NODE, /ipLocationStore - baseline installed/),
      'nothing was ingested over the good table').to.equal(1);
  });

  it('keeps the table it has when the artifact disappears entirely', async function () {
    this.timeout(300000);
    // Both representations 404 from here on: the publication is gone, which is
    // what a node sees during a publisher outage or a botched release.
    await publish({ artifact: null });

    await restartAndSettle(REFRESH_NODE);
    await waitFor(async () => (await fetchCounts()).missing >= 1, {
      timeout: 180000, interval: 2000, label: 'the restarted node finds no artifact to fetch',
    });

    const counts = await fetchCounts();
    expect(counts.ok, 'there was nothing to download').to.equal(0);
    // its second restart, and its second adopt: the rows outlive the process
    // whether or not the publisher is there to confirm them
    await waitFor(() => env.nodeLogCount(REFRESH_NODE, /ipLocationStore - adopted the stored baseline/) === 2, {
      timeout: 30000, interval: 500, label: 'the node adopted its stored rows on this restart as well',
    });
    expect(env.nodeLogCount(REFRESH_NODE, /ipLocationStore - baseline installed/),
      'and still holds the one ingest it ever did').to.equal(1);

    const answer = await tableAnswer(env.clients[REFRESH_NODE], 5);
    expect(answer.tableAvailable, 'a missing artifact does not un-ingest a table').to.equal(true);
    expect(answer.tableGenerated).to.equal(baselineGenerated);
    expect(answer.domainCount).to.equal(BASELINE_DOMAINS);

    // The other posture - a node that never had a table at all - cannot be
    // reached by taking one away, because taking it away is exactly what this
    // proves does nothing. It needs a fleet that boots with no artifact to
    // fetch, which is the second fleet at the bottom of this file.
  });

  it('accepts a satisfiable geography, then refuses the same one once the table narrows it', async function () {
    this.timeout(360000);
    // The split gives each organisation a different country and the baseline's
    // countries all sit on one continent, so a continent allow admits the whole
    // fleet. Read from the served table rather than written into the assertion.
    const allowFleetContinent = `ac${fleetContinent}`;
    const accepted = await verifyRegistration(gateSpec({
      name: appName, instances: instanceCount, geolocation: [allowFleetContinent],
    }));
    expect(accepted.status, JSON.stringify(accepted.data)).to.equal('success');
    // the formatted spec the node itself produced IS what the network stores, so
    // the update path below compares against exactly that
    registeredSpec = accepted.data;

    // Give the app a past. An update is validated against the specifications it
    // replaces, which the node reads out of the permanent message collection.
    await dbClient(env.clients[QUERY_NODE].num)
      // seeded relative to this suite's chain: a literal here expires the app
      // before the fleet's first block, and this suite restarts FluxOS - which
      // re-arms expireGlobalApplications and deletes the very app it asserts on
      .seedPermanentMessage(await permanentRegistrationMessage(registeredSpec, env.initialHeight + 10));

    // Now the publisher moves a fleet address into the artifact's non-European
    // country. Nothing about the app changes; its geography simply stops being
    // deliverable.
    await publish({ domains: NARROWED_DOMAINS, subnet: subnet.base });
    const narrowedGenerated = (await stubState()).ipLocation.generated;
    expect(narrowedGenerated).to.not.equal(baselineGenerated);
    await restartAndSettle(QUERY_NODE, { generated: narrowedGenerated });

    const tree = await locationsTree(env.clients[QUERY_NODE]);
    const stillHere = tree.continents[fleetContinent]?.nodes ?? 0;
    expect(stillHere, 'the narrowed split moved a node off the fleet continent')
      .to.be.lessThan(instanceCount);
    expect(stillHere, 'but not all of them - a total miss is not a proof, and would be allowed through')
      .to.be.greaterThan(0);

    // Same spec, same node, new table: what was deliverable at registration is
    // now provably short, so the front door refuses it before it is paid for.
    const refused = await verifyRegistration(gateSpec({
      name: `${appName}b`, instances: instanceCount, geolocation: [allowFleetContinent],
    }));
    expect(refused.status).to.equal('error');
    expect(refused.data.message).to.include('eligible nodes');
    expect(refused.data.message).to.include('Widen the allowed locations');
  });

  it('never gates an expire-only update, and still gates one that changes placement', async function () {
    this.timeout(120000);
    // The owner of the app above can no longer register it. They must still be
    // able to renew it and to cancel it: refusing those would strand them with
    // an app they can neither keep nor stop paying for, on a geography they did
    // not narrow. Neither update touches anything placement depends on, so the
    // gate never runs.
    const renewal = await verifyUpdate({ ...registeredSpec, expire: 33000 });
    expect(renewal.status, JSON.stringify(renewal.data)).to.equal('success');
    const cancellation = await verifyUpdate({ ...registeredSpec, expire: 1 });
    expect(cancellation.status, JSON.stringify(cancellation.data)).to.equal('success');

    // Identical instance count, identical geography, identical everything except
    // one component's disk - which placement DOES depend on. That is the whole
    // difference between this and the renewal above, and it is enough for the
    // gate to apply and the narrowed table to refuse.
    const resized = await verifyUpdate({
      ...registeredSpec,
      compose: [{ ...registeredSpec.compose[0], hdd: registeredSpec.compose[0].hdd + 1 }],
    });
    expect(resized.status).to.equal('error');
    expect(resized.data.message).to.include('eligible nodes');

    // And the plainest placement change of all.
    const bumped = await verifyUpdate({ ...registeredSpec, instances: instanceCount + 1 });
    expect(bumped.status).to.equal('error');
    expect(bumped.data.message).to.include('eligible nodes');
  });
});

// The other half of the tableless contract: a fleet that never had a table at
// all. The suite above proves that taking the artifact away leaves an ingested
// table alone, which by construction cannot produce this state - it needs its
// own fleet, booted against a publisher serving nothing.
//
// What a tableless node owes its callers: placement still ANSWERS, on the /16
// arithmetic the network used before the table existed (one domain for a fleet
// that shares a /16, every node a candidate), while the two answers that would
// be meaningless without a table - the geography tree, and any question about a
// geolocation - say so with a 503 instead of inventing whole-network numbers.
describe('a fleet with no artifact to fetch holds the tableless posture', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const fetchCounts = async () => {
    const state = await (await fetch(`${env.stubControl}/state`)).json();
    return state.ipLocationFetches[BINARY_ROUTE];
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 2, minIncoming: 1 } },
    });
    // Withdrawn before the fleet's table fetch, so no node ever sees an
    // artifact: both representations 404 for the life of this fleet.
    await fetch(`${env.stubControl}/iplocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact: null }),
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    // Every node has TRIED and found nothing - the difference between the
    // posture this asserts and a fleet that simply has not got there yet.
    await waitFor(async () => (await fetchCounts()).missing >= env.nodeCount, {
      timeout: 240000, interval: 3000, label: 'every node looked for the artifact and found none',
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('answers unrestricted placement on /16 arithmetic and refuses to guess at geography', async function () {
    this.timeout(60000);
    const counts = await fetchCounts();
    expect(counts.ok, 'there was never anything to download').to.equal(0);
    expect(counts.missing, 'every node asked').to.be.at.least(env.nodeCount);

    const answers = await Promise.all(env.clients.map((client) => client.post('/apps/placementfeasibility', {
      instances: 3,
      geolocation: [],
      compose: [{ containerData: 'g:/data' }],
    }, { zelidauth: client.zelidauth })));
    answers.forEach((answer, index) => {
      expect(answer.status, `node ${index} answers an unrestricted question`).to.equal('success');
      expect(answer.data.tableAvailable).to.equal(false);
      expect(answer.data.tableGenerated).to.equal(null);
      expect(answer.data.candidateCount, 'every node is a candidate').to.equal(env.nodeCount);
      expect(answer.data.domainCount, 'the fleet shares one /16, so one fault domain').to.equal(1);
      expect(answer.data.satisfiable).to.equal(true);
    });

    // A geo-restricted question computed over the whole network would advise a
    // purchase on numbers that mean nothing, so it is answered as unavailable.
    const geoRestricted = await env.clients[0].post('/apps/placementfeasibility', {
      instances: 3,
      geolocation: ['acEU'],
      compose: [{ containerData: 'g:/data' }],
    }, { zelidauth: env.clients[0].zelidauth });
    expect(geoRestricted.status).to.equal('error');
    expect(geoRestricted.data.message).to.include('not available');

    // The geography tree IS the table's product; without one there is nothing
    // to serve but the fallback totals, which are not the placement geography.
    const tree = await env.clients[0].get('/apps/placementlocations');
    expect(tree.status).to.equal('error');
    expect(tree.data.message).to.include('not available');
  });

  it('does not refuse a registration it cannot prove impossible', async function () {
    this.timeout(60000);
    await pushTestApp(APP_IMAGE);
    // Without a table nothing about geography is provable, so the gate stays
    // permissive: only a proven shortfall may refuse a registration, and a
    // tableless node has no proof of anything.
    const response = await env.clients[0].post(
      '/apps/verifyappregistrationspecifications',
      gateSpec({ name: `e2etableless${Date.now()}`, instances: 3, geolocation: ['acEU_DE'] }),
      { 'Content-Type': 'text/plain' },
    );
    expect(response.status, JSON.stringify(response.data)).to.equal('success');
  });
});
