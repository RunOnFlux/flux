/*
 * An unpaid app message enters the network only through a node that holds a
 * quorum of authenticated Arcane links, only once peers on that quorum of IPs
 * hold it, and, carrying a client tag, over authenticated links alone.
 *
 * The fleet: seven Arcane nodes, one legacy node, an Arcane stub peer and a
 * plain one. admissionQuorum is 2, which every Arcane node meets with room to
 * spare - the worst-placed carries three authenticated peers; the legacy node
 * refuses at its door whatever its links. Every peer but the entry
 * node holds one admitting operator to one pending message (originKeyCap 1), so
 * the entry node's second registration is one its peers refuse while its own
 * door takes it.
 *
 * Until the version floor reaches the first release that tags, an untagged
 * message, as a release that does not tag sends it, is taken from any link.
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
// The nodes whose keys sign the origins the stubs carry: one each, so the two
// relayed messages draw on separate operator allowances whatever order a node
// hears them in.
const PLAIN_ADMITTER = 5;
const ARCANE_ADMITTER = 6;
const QUORUM = 2;
// An entry node whose admitting-operator allowance no other test uses.
const SLOW_ENTRY = 4;
const BEFORE_HELD = 'admission:beforeHeld';
// Past the per-peer silence bound (1 s) and past 2 s, within admissionTimeoutMs.
const PEER_CHECK_MS = 3000;

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
  const relayedMessage = async (admitter) => {
    relayed += 1;
    const app = await buildSeedableApp({ env, name: `e2equorumrelay${relayed}x${stamp}`, instances: 1 });
    const fields = { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() };
    const origin = await admittingSignature(pendingMessage(app, fields), nodeKey(admitter + 1));
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

  // Peers that take longer to check a message than the silence bound (1 s) and
  // the old round (2 s), within admissionTimeoutMs: each has answered received,
  // so each still counts. SLOW_ENTRY's operator allowance is its own.
  it('admits a registration whose peers take seconds to check it', async function () {
    this.timeout(120000);
    const slowEntry = env.clients[SLOW_ENTRY];
    const peers = ARCANE.filter((i) => i !== SLOW_ENTRY);
    const marks = Object.fromEntries(peers.map((i) => [i, env.clients[i].getLastEventId()]));
    const mark = slowEntry.getLastEventId();
    await Promise.all(peers.map((i) => env.clients[i].holdCheckpoint(BEFORE_HELD, '*')));
    try {
      const registration = register(SLOW_ENTRY, `e2equorumslow${stamp}`);
      let pausedAt = null;
      await waitFor(() => {
        const paused = peers.filter((i) => env.clients[i].getEventBuffer()
          .some((e) => e.id > marks[i] && e.event === 'checkpoint:held' && e.data.name === BEFORE_HELD));
        if (paused.length >= QUORUM && pausedAt === null) pausedAt = Date.now();
        return pausedAt !== null;
      }, { timeout: 60000, interval: 200, label: 'peers on the quorum paused before answering held' });
      // The controlled delay this test is about: the peers stay paused for
      // PEER_CHECK_MS before they answer.
      await waitFor(() => Date.now() - pausedAt >= PEER_CHECK_MS, {
        timeout: PEER_CHECK_MS + 5000, interval: 100, label: `${PEER_CHECK_MS} ms of peer checks`,
      });
      await Promise.all(peers.map((i) => env.clients[i].releaseCheckpoint(BEFORE_HELD, '*')));

      const result = await registration;
      expect(result.status, JSON.stringify(result)).to.equal('success');
      const quorum = await slowEntry.waitForEvent('appmessage:quorum', (d) => d.hash === result.data, 30000, { afterId: mark });
      expect(quorum.data.committed, JSON.stringify(quorum.data)).to.equal(true);
      const answered = quorum.data.members.filter((m) => m.state === 'held').map((m) => m.answeredMs);
      expect(answered.length, JSON.stringify(quorum.data)).to.be.at.least(QUORUM);
      answered.forEach((ms) => expect(ms, JSON.stringify(quorum.data)).to.be.at.least(PEER_CHECK_MS));
    } finally {
      await Promise.all(peers.map((i) => env.clients[i].releaseCheckpoint(BEFORE_HELD, '*').catch(() => {})));
    }
  });

  it('refuses at the door, with 501, on a node that is not ArcaneOS', async function () {
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

    expect(response.status, JSON.stringify(body)).to.equal(501);
    expect(body.data.name).to.equal('AdmissionNotSupported');
  });

  it('takes an untagged unpaid message from an unauthenticated link, as a release that does not tag sends it', async function () {
    this.timeout(120000);
    const app = await buildSeedableApp({ env, name: `e2equorumuntagged${stamp}`, instances: 1 });
    const marks = REAL.map((i) => env.clients[i].getLastEventId());

    await plainStub.broadcast(pendingMessage(app));

    const decisions = await Promise.all(REAL.map((i) => admissionOf(env.clients[i], app.hash, marks[REAL.indexOf(i)])));
    decisions.forEach((decision, at) => expect(decision, `node ${REAL[at]}: ${JSON.stringify(decision)}`).to.include({ taken: true, clientTag: null }));
  });

  it('takes an unpaid message on an Arcane node only over an authenticated link', async function () {
    this.timeout(120000);
    const marks = REAL.map((i) => env.clients[i].getLastEventId());
    const unauthenticated = await relayedMessage(PLAIN_ADMITTER);
    const authenticated = await relayedMessage(ARCANE_ADMITTER);

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
