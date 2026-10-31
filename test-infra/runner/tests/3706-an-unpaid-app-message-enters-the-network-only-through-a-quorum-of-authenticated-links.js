/*
 * An unpaid app message enters the network only through a node that holds a
 * quorum of authenticated Arcane links, only once peers on that quorum of IPs
 * hold it, and over authenticated links alone.
 *
 * The fleet: seven Arcane nodes, one legacy node, an Arcane stub peer and a
 * plain one. admissionQuorum is 2, which every Arcane node meets with room to
 * spare - the worst-placed carries three authenticated peers - and which the
 * legacy node, authenticating nothing, never meets. Every peer but the entry
 * node holds one admitting operator to one pending message (originKeyCap 1), so
 * the entry node's second registration is one its peers refuse while its own
 * door takes it.
 *
 * The harness's fluxbench is the daemon stub's: what a green run shows is the
 * protocol between FluxOS processes, not SAS's encryption.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp, signAppSpec } from '../framework/app-helper.js';
import { authenticate } from '../auth.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, admittingSignature, pendingMessageOn, admissionOf,
} from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 10;
const LEGACY = 7;
const ARCANE_STUB = 8;
const PLAIN_STUB = 9;
const ARCANE = [0, 1, 2, 3, 4, 5, 6];
const REAL = [...ARCANE, LEGACY];
// The middle of the ring: index 0's backward arc wraps onto the stubs.
const ENTRY = 3;
// The node whose key signs the origins the stubs carry.
const ADMITTER = 5;
const QUORUM = 2;

describe('an unpaid app message enters the network only through a quorum of authenticated links', function () {
  let env;
  let arcaneStub;
  let plainStub;
  let admitted;
  const stamp = Date.now();
  const owner = appOwnerKey();

  dumpLogsOnFailure(() => env);

  const holders = async (hash) => {
    const held = await Promise.all(REAL.map((i) => pendingMessageOn(env.clients[i], hash)));
    return REAL.filter((_, at) => held[at] !== null);
  };

  const register = (index, name) => registerApp(
    env.clients[index].url,
    nodeKey(index + 1),
    buildAppSpec({ name, ownerKey: owner }),
    'fluxappregister',
    { ownerKey: owner },
  );

  // A pending message as a relay carries it: the admitter's signature over it.
  let relayed = 0;
  const relayedMessage = async () => {
    relayed += 1;
    const app = buildSeedableApp({ env, name: `e2equorumrelay${relayed}x${stamp}`, instances: 1 });
    const fields = { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() };
    const origin = await admittingSignature(pendingMessage(app, fields), nodeKey(ADMITTER + 1));
    return pendingMessage(app, { ...fields, origin });
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      legacyNodes: [LEGACY],
      stubPeers: [ARCANE_STUB, PLAIN_STUB],
      arcaneStubPeers: [ARCANE_STUB],
      configOverrides: { fluxapps: { admissionQuorum: QUORUM } },
      nodeConfigOverrides: Object.fromEntries(REAL.filter((i) => i !== ENTRY)
        .map((i) => [i, { fluxapps: { originKeyCap: 1 } }])),
    });
    await bootAndPeer(env);
    arcaneStub = env.stubPeerClients.get(ARCANE_STUB);
    plainStub = env.stubPeerClients.get(PLAIN_STUB);
    await waitFor(async () => (await arcaneStub.connectedNodes()) >= REAL.length && (await plainStub.connectedNodes()) >= REAL.length, {
      timeout: 120000, interval: 2000, label: 'every real node connected to both stub peers',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('admits a registration once peers on the quorum of IPs hold it, and every node then holds it', async function () {
    this.timeout(120000);
    const entry = env.clients[ENTRY];
    const mark = entry.getLastEventId();

    const result = await register(ENTRY, `e2equorumreg${stamp}`);

    expect(result.status, JSON.stringify(result)).to.equal('success');
    admitted = result.data;
    const quorum = await entry.waitForEvent('appmessage:quorum', (d) => d.hash === admitted, 30000, { afterId: mark });
    expect(quorum.data.committed).to.equal(true);
    expect(quorum.data.heldBy).to.be.at.least(QUORUM);
    await waitFor(async () => (await holders(admitted)).length === REAL.length, {
      timeout: 60000, interval: 2000, label: `${admitted} held by every node`,
    });
  });

  it('stores a message its peers refuse nowhere, and tells the caller why', async function () {
    this.timeout(120000);
    const entry = env.clients[ENTRY];
    const mark = entry.getLastEventId();

    const result = await register(ENTRY, `e2equorumrefused${stamp}`);

    expect(result.status, JSON.stringify(result)).to.equal('error');
    expect(result.data.message).to.match(/The network refused this app message: .*admitting operator already has 1 unpaid app messages pending/);
    const quorum = await entry.waitForEvent('appmessage:quorum', (d) => d.committed === false, 30000, { afterId: mark });
    expect(quorum.data.heldBy).to.equal(0);
    // the first test's message is still read where it is held
    expect(await holders(admitted)).to.have.length(REAL.length);
    expect(await holders(quorum.data.hash), 'nodes holding the refused message').to.deep.equal([]);
  });

  it('refuses at the door, with 503, on a node that cannot authenticate a link', async function () {
    this.timeout(60000);
    const { url } = env.clients[LEGACY];
    const auth = await authenticate(url, nodeKey(LEGACY + 1));
    const signed = await signAppSpec(buildAppSpec({ name: `e2equorumlegacy${stamp}`, ownerKey: owner }), 'fluxappregister', owner);

    const response = await fetch(`${url}/apps/appregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', zelidauth: auth.zelidauth },
      body: JSON.stringify(signed),
    });
    const body = await response.json();

    expect(response.status).to.equal(503);
    expect(body.data.name).to.equal('AdmissionUnavailable');
  });

  it('takes an unpaid message on an Arcane node only over an authenticated link', async function () {
    this.timeout(120000);
    const marks = REAL.map((i) => env.clients[i].getLastEventId());
    const unauthenticated = await relayedMessage();
    const authenticated = await relayedMessage();

    await plainStub.broadcast(unauthenticated);
    await arcaneStub.broadcast(authenticated);

    const refusedBy = await Promise.all(ARCANE.map((i) => admissionOf(env.clients[i], unauthenticated.hash, marks[REAL.indexOf(i)])));
    refusedBy.forEach((decision) => {
      expect(decision.taken).to.equal(false);
      expect(decision.reason).to.equal('it did not arrive over an authenticated Arcane link');
    });
    // a legacy node takes what reaches it on any link
    expect((await admissionOf(env.clients[LEGACY], unauthenticated.hash, marks[REAL.indexOf(LEGACY)])).taken).to.equal(true);
    // the same kind of message over an authenticated link is taken
    const takenBy = await Promise.all(ARCANE.map((i) => admissionOf(env.clients[i], authenticated.hash, marks[REAL.indexOf(i)])));
    takenBy.forEach((decision) => expect(decision.taken, JSON.stringify(decision)).to.equal(true));
  });
});
