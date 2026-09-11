// weight: medium
import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { assignPorts } from '../framework/port-allocator.js';
import { appOwnerKey, userKey } from '../framework/keys.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { nodeOutpoint } from '../framework/seed-helper.js';
import { buildEnterpriseBlob } from '../framework/enterprise-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The signed policy bundle, end to end on one node: obtained, verified, persisted,
// restored, and refused when it should be. Plus the validator rules that only mean
// anything once a node knows who the enterprise owners are.
//
// One node, because none of this involves a second one. Policy reaching a node from its
// PEERS is suite 101; where a pinned app actually lands is suite 102.
// /apps/verifyappregistrationspecifications is the whole validator without the front
// door's peer counts - those live in registryManager's appregister path
// (registryManager.js:1860 and :1863), not here - so a fleet of one can exercise every
// rule the validator has.
//
// What a node BELIEVES is read from mongo, not from /flux/enterpriseappowners. That
// endpoint is served through apicache for an hour and remembers its first successful
// answer, so it can be asserted once and never again after a policy change. It answers
// an ERROR while policy is unknown, and errors are not remembered (routeGuards.js's
// answeredWithoutFailure), which is the one case it can be polled on.

const APP_IMAGE = 'e2e-policy-probe';

// An owner in the harness bundle's enterprise map, and one that is not.
//
// TAKEN FROM THE FIXTURE KEYS, never written out. Neither needs its private half here -
// the validator checks the owner FIELD against the policy and signature checking belongs
// to appregister, which this suite does not use - but an address still has to BE one.
// A hand-typed address fails base58check, and the validator says so
// ('Invalid Flux App owner') long before it reaches any rule this suite is about, which
// is a refusal that looks like the rule working.
const ENTERPRISE_OWNER = userKey().zelid;
const ORDINARY_OWNER = appOwnerKey().zelid;

// The node's own pubkey is not known until it boots, so the map is keyed on a placeholder.
// Nothing in the eligibility rule looks at WHICH node an owner may use - that is the
// spawner's question, and suite 102 asks it. Here the map exists to make an owner
// enterprise, and the union of its values is the whole answer.
const ENTERPRISE_MAP = { '04harnessenterprisenodepubkey': [ENTERPRISE_OWNER] };

// The pins name THIS FLEET'S ONE NODE, by each of the two forms a `nodes` entry may take.
//
// They have to name a real node, and the run's own address at that. placementFeasibility's
// pooledNodes treats a pin as a CLOSED POOL - the candidate set becomes exactly the pinned
// entries - so a pin naming nobody leaves zero candidates and the spec is refused as
// impossible, several rules past the one being tested. run-all.sh claims a per-run /24, so
// a literal address is the wrong one on most runs; subnet-config knows which.
//
// nodeOutpoint reads the same fixture the daemon stub answers getzelnodestatus from, so
// the outpoint form names the node the node agrees it is.
const PIN_BY_ADDRESS = `${getSubnetConfig().nodeIp(1)}:16127`;
const PIN_BY_OUTPOINT = nodeOutpoint(0);

/**
 * A v8 spec for the verify endpoint.
 *
 * `nodes` REQUIRES `enterprise`. appValidator.js:381 refuses a v8 spec carrying a pin
 * without one - 'Nodes can only be used in enterprise apps' - and that rule sits ahead of
 * the eligibility rule this suite is about, so a pinned spec built with `enterprise: ''`
 * never reaches it and fails on a sentence about something else entirely.
 *
 * That ordering is the whole point of the rule under test. Pinning was already confined
 * to encrypted specs; what nothing checked was WHOSE. So the fixture has to be the shape
 * the hole had: a real blob, from any owner at all.
 *
 * An enterprise spec carries its components INSIDE the blob and an empty compose, which
 * is how the chain sees it - the node decrypts before it validates.
 */
function policySpec({ name, owner = ORDINARY_OWNER, nodes = [], datacenter, enterprise = nodes.length > 0 }) {
  const components = [{
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
  }];
  // Before the blob is sealed: a port assigned afterwards is a port the node never sees.
  assignPorts(components, name);
  const spec = {
    version: 8,
    name,
    description: `policy probe ${name}`,
    owner,
    compose: enterprise ? [] : components,
    // One, because one node is the whole eligible pool: the placement gate runs after the
    // validator and would refuse a larger count for a reason this suite is not about.
    // v8 may ask for one above minimumInstancesV8Block, and the harness chain starts at
    // 2952000 (chain-start.cjs), well above it.
    instances: 1,
    contacts: [],
    geolocation: [],
    expire: 22000,
    nodes,
    staticip: false,
    enterprise: enterprise ? buildEnterpriseBlob(components, []) : '',
  };
  if (datacenter !== undefined) spec.datacenter = datacenter;
  return spec;
}

const stub = (env, path, body) => fetch(`${env.stubControl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

const stubState = (env) => fetch(`${env.stubControl}/state`).then((r) => r.json());

describe('the signed policy bundle on a single node', function () {
  let env;
  let node;
  let db;

  // A legacy req.on('data') handler: express.json() would consume the stream first and
  // its 'end' would never fire, so the request hangs until the test times out. text/plain
  // leaves the body for the handler to read.
  const verify = (spec) => node.post(
    '/apps/verifyappregistrationspecifications',
    spec,
    { 'Content-Type': 'text/plain' },
  );

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(360000);
    // The enterprise map is published BEFORE the fleet boots, so the validator tests below
    // do not depend on an earlier test having run to put it there - and so none of them is
    // racing the node's one boot-time resolution.
    env = await createTestEnv({
      hookCtx: this,
      nodes: 1,
      tickerAutostart: false,
      policy: { documents: { enterprisenodes: ENTERPRISE_MAP } },
    });
    [node] = env.clients;
    db = dbClient(1);
    await pushTestApp(APP_IMAGE);
    await waitForBootSettled(node);
    // Boot resolves policy from the backstop; nothing else here is meaningful until it has.
    await waitFor(async () => Boolean(await db.policyBundle()), {
      timeout: 90000,
      label: 'the node to adopt a policy bundle',
    });
  });

  after(async function () {
    this.timeout(60000);
    await stub(env, '/policy', { available: true, body: null, signer: 'pinned' }).catch(() => {});
    await env?.teardown();
  });

  describe('obtaining it', function () {
    it('adopts the published bundle and stores the bytes it verified', async function () {
      this.timeout(60000);
      const served = await stubState(env);
      const stored = await db.policyBundle();
      expect(stored, 'a bundle row exists').to.not.be.null;
      expect(stored.seq, 'the node holds the sequence the stub published').to.equal(served.policySeq);
      // Stored as the bytes that were verified rather than as the parsed payload - a
      // re-serialised document would no longer check against its own signature, which is
      // the whole reason the row is worth keeping.
      expect(stored.raw).to.be.a('string');
      const envelope = JSON.parse(stored.raw);
      expect(Object.keys(envelope).sort()).to.deep.equal(['payload_b64', 'sig_b64']);
      const payload = JSON.parse(Buffer.from(envelope.payload_b64, 'base64').toString('utf8'));
      expect(payload.seq).to.equal(served.policySeq);
      expect(Object.keys(payload.documents).sort()).to.deep.equal([
        'blockedrepositories', 'enterprisenodes', 'tamperingblockednodes', 'vettedrepositories',
      ]);
    });

    it('the readers see the document the bundle carried', async function () {
      this.timeout(60000);
      // Read once, and only here: apicache remembers this answer for an hour, so a later
      // read would be this one however much the policy has moved on since.
      const owners = await node.get('/flux/enterpriseappowners');
      expect(owners.status).to.equal('success');
      expect(owners.data).to.deep.equal([ENTERPRISE_OWNER]);
    });

    it('a document published after boot reaches the node', async function () {
      this.timeout(120000);
      const before = (await db.policyBundle()).seq;
      const { seq } = await stub(env, '/blocked-repos', ['blocked/by-policy:v1']);
      expect(seq, 'the stub advanced its sequence').to.be.greaterThan(before);
      // Nothing pushes here: this node has no peers to be told by, and the backstop poll
      // is 24 hours. A restart is how a single node learns, and it is also the cheapest
      // proof that the boot path resolves from the source rather than only from the row.
      await env.restartNode(0);
      await waitForBootSettled(node);
      await waitFor(async () => (await db.policyBundle()).seq === seq, {
        timeout: 90000,
        label: `the node to adopt seq ${seq}`,
      });
      const stored = await db.policyBundle();
      const payload = JSON.parse(
        Buffer.from(JSON.parse(stored.raw).payload_b64, 'base64').toString('utf8'),
      );
      expect(payload.documents.blockedrepositories).to.deep.equal(['blocked/by-policy:v1']);
      // and the document published before boot is still there, unchanged by the new one
      expect(payload.documents.enterprisenodes).to.deep.equal(ENTERPRISE_MAP);
    });
  });

  describe('the rules the validator applies once policy is known', function () {
    it('refuses to pin a v8 app for an owner the policy does not list', async function () {
      this.timeout(60000);
      const response = await verify(policySpec({
        name: `pinreject${Date.now()}`,
        owner: ORDINARY_OWNER,
        nodes: [PIN_BY_ADDRESS],
      }));
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('only available for enterprise app owners');
    });

    it('accepts the same spec for an owner the policy does list', async function () {
      this.timeout(60000);
      const response = await verify(policySpec({
        name: `pinaccept${Date.now()}`,
        owner: ENTERPRISE_OWNER,
        nodes: [PIN_BY_ADDRESS],
      }));
      expect(response.status).to.equal('success');
    });

    it('accepts a pin written as a collateral outpoint, not only as an address', async function () {
      this.timeout(60000);
      const response = await verify(policySpec({
        name: `pinoutpoint${Date.now()}`,
        owner: ENTERPRISE_OWNER,
        nodes: [PIN_BY_OUTPOINT],
      }));
      expect(response.status).to.equal('success');
    });

    it('leaves an unpinned app alone whoever owns it', async function () {
      this.timeout(60000);
      const response = await verify(policySpec({
        name: `nopin${Date.now()}`,
        owner: ORDINARY_OWNER,
        nodes: [],
      }));
      expect(response.status).to.equal('success');
    });

    it('refuses datacenter placement for an owner the policy does not list', async function () {
      this.timeout(60000);
      const response = await verify(policySpec({
        name: `dcreject${Date.now()}`,
        owner: ORDINARY_OWNER,
        datacenter: true,
      }));
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('enterprise app owners');
    });
  });

  describe('bundles it must refuse', function () {
    // Restoration belongs in a hook, not at the end of a test body. Test 12 used to
    // republish a good enterprisenodes document as its last statement; when its assertion
    // failed, that line never ran and the NEXT test inherited a malformed map and failed
    // for a reason that had nothing to do with it. A fixture a test breaks is a fixture
    // the suite has to put back whatever the test does.
    afterEach(async function () {
      this.timeout(30000);
      await stub(env, '/policy', {
        signer: 'pinned',
        body: null,
        available: true,
        documents: { enterprisenodes: ENTERPRISE_MAP },
      }).catch(() => {});
    });

    // Each of these publishes something the node must not take, then proves the node
    // still holds what it held. Held-not-adopted is the assertion, because a refusal
    // that dropped the policy would be a worse failure than accepting the bad bundle.
    //
    // Both halves are asserted on the STUB, not in the node's log: env.restartNode ends
    // that container's log collection, so a log assertion placed after one can only ever
    // time out. The stub survives the restart, and publishing resets its fetch counters,
    // so "the node came and asked for this exact bundle" is a count starting from zero.
    async function refused(publish, label) {
      const before = (await db.policyBundle()).seq;
      await publish();
      await env.restartNode(0);
      await waitForBootSettled(node);
      await waitFor(async () => (await stubState(env)).policyFetches.ok > 0, {
        timeout: 90000,
        label: 'the node to fetch the bundle it must refuse',
      });
      const after = await db.policyBundle();
      expect(after.seq, label).to.equal(before);
      return after;
    }

    it('refuses a bundle signed by a key it does not pin', async function () {
      this.timeout(150000);
      await refused(
        () => stub(env, '/policy', { signer: 'rogue' }),
        'a valid signature from an untrusted signer is fetched and not adopted',
      );
    });

    it('refuses a bundle whose sequence goes backwards', async function () {
      this.timeout(150000);
      await refused(
        () => stub(env, '/policy', { seq: 1 }),
        'a rollback is fetched and not adopted',
      );
    });

    it('refuses bytes that are not a bundle at all', async function () {
      this.timeout(150000);
      // Restored to a good, higher sequence first: the rollback above left the stub
      // publishing seq 1, and a node that refused it would refuse this for that reason
      // rather than for the one being tested.
      const stored = await db.policyBundle();
      await stub(env, '/policy', { seq: stored.seq + 1 });
      await refused(
        () => stub(env, '/policy', { body: 'this is not a signed bundle' }),
        'a body that is not a bundle is fetched and not adopted',
      );
    });

    it('adopts a correctly signed bundle whose document is malformed, and reads it as unknown', async function () {
      this.timeout(150000);
      // A signature says who published a document, never that its contents are the shape
      // the reader expects. The bundle is taken; the READER is what must refuse.
      const stored = await db.policyBundle();
      const seq = stored.seq + 1;
      await stub(env, '/policy', { seq, documents: { enterprisenodes: { '04abc': 'not-an-array' } } });
      await env.restartNode(0);
      await waitForBootSettled(node);
      await waitFor(async () => (await db.policyBundle()).seq === seq, {
        timeout: 90000,
        label: 'the malformed-document bundle to be adopted',
      });
      const owners = await node.get('/flux/enterpriseappowners');
      expect(owners.status, 'the reader answers unknown, never an empty list').to.equal('error');
      expect(owners.data.message).to.include('not yet obtained');
      // And a privilege that cannot be checked is refused rather than waved through.
      const response = await verify(policySpec({
        name: `unknownpin${Date.now()}`,
        owner: ENTERPRISE_OWNER,
        nodes: [PIN_BY_ADDRESS],
      }));
      expect(response.status).to.equal('error');
      expect(response.data.message).to.include('network policy not yet obtained');
    });
  });

  describe('surviving a source that stops answering', function () {
    // Same reasoning as the block above: these tests take the source away, and a failure
    // part way through must not leave it unavailable for whatever runs next.
    afterEach(async function () {
      this.timeout(30000);
      await stub(env, '/policy', { available: true, body: null, signer: 'pinned' }).catch(() => {});
    });

    it('restores the stored bundle at boot with the source returning 503', async function () {
      this.timeout(180000);
      await env.restartNode(0);
      await waitForBootSettled(node);
      await waitFor(async () => (await db.policyBundle()).seq === (await stubState(env)).policySeq, {
        timeout: 90000,
        label: 'the node to be level with the stub before the source goes away',
      });
      const held = await db.policyBundle();

      await stub(env, '/policy', { available: false });
      const fetchesBefore = (await stubState(env)).policyFetches.total;
      await env.restartNode(0);
      await waitForBootSettled(node);

      const after = await db.policyBundle();
      expect(after.seq, 'the node came back holding what it had').to.equal(held.seq);
      // It asked, and was refused - so the policy it holds came off its own disk rather
      // than from a source that happened to still be answering.
      await waitFor(async () => (await stubState(env)).policyFetches.unavailable > 0, {
        timeout: 60000,
        label: 'the node to try the unreachable backstop',
      });
      expect((await stubState(env)).policyFetches.total).to.be.greaterThan(fetchesBefore);

      // The gate is open on a restored bundle: acquisition waits on policy being KNOWN,
      // not on it being fresh.
      const owners = await node.get('/flux/enterpriseappowners');
      expect(owners.status).to.equal('success');
      await stub(env, '/policy', { available: true });
    });

    it('refuses to decide anything when it has no policy and cannot get one', async function () {
      this.timeout(240000);
      // The state the whole design exists for: nothing on disk, nothing reachable. A node
      // here must not guess that it is an ordinary node with no enterprise duties - that
      // guess is what filled enterprise nodes with apps the ownership sweep then removed
      // from under their owners.
      //
      // That acquisition itself is held shut is asserted in suite 101, not here: the spawn
      // loop only starts when the sync orchestrator reaches READY, which needs peers, so
      // on a fleet of one the loop never runs and `spawner:blocked` could never fire. A
      // wait for it here would pass its whole timeout and fail as though the gate were
      // open. What one node CAN show is the other half of the same rule - every decision
      // that grants a privilege fails closed.
      await stub(env, '/policy', { available: false });
      await db.deletePolicyBundle();
      await env.restartNode(0);
      await waitForBootSettled(node);

      expect(await db.policyBundle(), 'nothing was restored').to.be.null;
      const owners = await node.get('/flux/enterpriseappowners');
      expect(owners.status, 'the node says it cannot tell, not that nobody is eligible').to.equal('error');

      // A pin for an owner who WOULD be eligible under the policy this node cannot read.
      // Refused, because the alternative is granting a privilege on a guess.
      const pinned = await verify(policySpec({
        name: `nopolicypin${Date.now()}`,
        owner: ENTERPRISE_OWNER,
        nodes: [PIN_BY_ADDRESS],
      }));
      expect(pinned.status).to.equal('error');
      expect(pinned.data.message).to.include('network policy not yet obtained');

      const dc = await verify(policySpec({
        name: `nopolicydc${Date.now()}`,
        owner: ENTERPRISE_OWNER,
        datacenter: true,
      }));
      expect(dc.status).to.equal('error');
      expect(dc.data.message).to.include('network policy not yet obtained');

      // An ordinary app is still accepted: the policy gates privileges, not registration.
      const ordinary = await verify(policySpec({ name: `nopolicyplain${Date.now()}` }));
      expect(ordinary.status).to.equal('success');

      // And it recovers the moment a source answers again, without intervention.
      await stub(env, '/policy', { available: true });
      await env.restartNode(0);
      await waitForBootSettled(node);
      await waitFor(async () => Boolean(await db.policyBundle()), {
        timeout: 90000,
        label: 'the node to adopt once the source answers again',
      });
    });
  });
});
