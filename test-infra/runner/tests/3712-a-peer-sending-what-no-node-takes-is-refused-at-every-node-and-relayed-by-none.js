/*
 * A peer sending what no node takes is refused by the node it reaches, and so
 * relayed by none: a broadcast over the per-message limit, an install error over
 * its length, an enterprise string over its length, and a frame over the frame
 * limit. A caller that opens connections and never finishes their link handshake
 * is held to the node's inbound limit and to its allowed ports, and a frame
 * replayed on an authenticated link is dropped.
 *
 * The stub peer is an Arcane node that authenticates its links, peered with one
 * Arcane node (ENTRY) and one legacy node (LEGACY) and nothing else; the other
 * two real nodes hear from it only through a relay. Each refusal is checked on
 * both nodes it reaches, because the encrypted-spec rules hold on a node that
 * cannot decrypt as on one that can. Each case's canary is the same message, or
 * one of its kind, within the limit: it is stored on, or relayed to, every real
 * node, which shows the path that refused the other one was reached and carries
 * messages.
 *
 * Each verdict is whichever the node reaches first, the refusal or the message
 * stored, so a node that takes what it should refuse fails at the assertion on
 * its verdict.
 *
 * Out of reach: fluxbench's real AES-key unwrap. The daemon stub answers every
 * decryptrsamessage with one fixed key.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { pendingMessage, pendingMessageOn, pendingVerdict } from '../framework/unpaid-messages.js';
import { waitFor, waitForFirstEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import limits from '../framework/message-limits.cjs';

const {
  GOSSIP_MESSAGE_MAX_BYTES, PEER_FRAME_MAX_BYTES, MAX_ENTERPRISE_LENGTH, INSTALL_ERROR_MAX_LENGTH,
} = limits;

const NODES = 5;
const STUB = 4;
const REAL = [0, 1, 2, 3];
const ENTRY = 1;
const LEGACY = 3;
// The legacy node first: it decrypts nothing, so it takes what only the rules refuse.
const REACHED = [LEGACY, ENTRY];

describe('a peer sending what no node takes is refused at every node and relayed by none', function () {
  let env;
  let stub;
  const stamp = Date.now();
  let count = 0;
  const name = (label) => { count += 1; return `e2esize${label}${count}x${stamp}`; };

  dumpLogsOnFailure(() => env);

  const marksOf = (nodes) => Object.fromEntries(nodes.map((i) => [i, env.clients[i].getLastEventId()]));
  const storedOn = async (i, hash) => (await pendingMessageOn(env.clients[i], hash)) !== null;
  const storedOnEvery = (hash, label) => waitFor(
    async () => (await Promise.all(REAL.map((i) => storedOn(i, hash)))).every(Boolean),
    { timeout: 120000, interval: 2000, label },
  );
  const refusedFor = (hash, reason) => ({
    event: 'network:appmessageRefused', matches: (d) => d.hash === hash && (!reason || d.reason.includes(reason)),
  });

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      legacyNodes: [LEGACY],
      stubPeers: [STUB],
      arcaneStubPeers: [STUB],
      stubPeeredWith: { [STUB]: REACHED },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => {
      const stats = await stub.getStats();
      return stats.connectionsOpen >= REACHED.length && stats.linksAuthenticatedOpen >= 1;
    }, { timeout: 120000, interval: 2000, label: 'the stub connected to both nodes it reaches, its link with ENTRY authenticated' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('drops a broadcast over the per-message limit unhandled, and takes the same message within it', async function () {
    this.timeout(300000);
    const app = await buildSeedableApp({ env, name: name('frame'), instances: 1 });
    const message = pendingMessage(app);
    const marks = marksOf(REACHED);

    await stub.broadcast({ ...message, padding: 'x'.repeat(GOSSIP_MESSAGE_MAX_BYTES) });

    for (const i of REACHED) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await pendingVerdict(env.clients[i], app.hash, {
        event: 'peers:frameDropped', matches: (d) => d.type === message.type && d.bytes > GOSSIP_MESSAGE_MAX_BYTES,
      }, { afterId: marks[i], label: `node ${i}'s verdict on the oversized broadcast` });
      expect(verdict, `node ${i}`).to.have.property('refused');
    }

    await stub.broadcast(message);
    await storedOnEvery(app.hash, 'the same message within the limit, stored on every real node');
  });

  it('refuses an install error over its length, and relays one of exactly its length to every node', async function () {
    this.timeout(240000);
    const app = await buildSeedableApp({ env, name: name('error'), instances: 1 });
    const installError = (length) => ({
      type: 'fluxappinstallingerror',
      version: 1,
      name: app.spec.name,
      hash: app.hash,
      error: 'e'.repeat(length),
      ip: `${stub.ip}:16127`,
      broadcastedAt: Date.now(),
    });
    const outcomes = [
      { event: 'network:appinstallingerror', matches: (d) => d.name === app.spec.name },
      { event: 'network:appinstallingerrorRefused', matches: (d) => d.name === app.spec.name },
    ];

    let marks = marksOf(REACHED);
    await stub.broadcast(installError(INSTALL_ERROR_MAX_LENGTH + 1));
    for (const i of REACHED) {
      // eslint-disable-next-line no-await-in-loop
      const first = await waitForFirstEvent(env.clients[i], outcomes, { afterId: marks[i] });
      expect(first.event, `node ${i}: ${JSON.stringify(first.data)}`).to.equal('network:appinstallingerrorRefused');
    }

    marks = marksOf(REAL);
    await stub.broadcast(installError(INSTALL_ERROR_MAX_LENGTH));
    for (const i of REAL) {
      // eslint-disable-next-line no-await-in-loop
      const first = await waitForFirstEvent(env.clients[i], outcomes, { afterId: marks[i], timeout: 90000 });
      expect(first.event, `node ${i}: ${JSON.stringify(first.data)}`).to.equal('network:appinstallingerror');
    }
  });

  it('refuses an enterprise string over its length on both nodes, and only a node that decrypts refuses one of exactly its length', async function () {
    this.timeout(300000);
    const over = await buildSeedableApp({
      env, name: name('long'), instances: 1, compose: [], enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH + 1),
    });
    const exact = await buildSeedableApp({
      env, name: name('exact'), instances: 1, compose: [], enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH),
    });

    let marks = marksOf(REACHED);
    await stub.broadcast(pendingMessage(over));
    for (const i of REACHED) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await pendingVerdict(env.clients[i], over.hash, refusedFor(over.hash), {
        afterId: marks[i], label: `node ${i}'s verdict on the enterprise string over its length`,
      });
      expect(verdict, `node ${i}: ${JSON.stringify(verdict)}`).to.have.nested.property('refused.reason')
        .that.includes('Enterprise specification is too long');
    }

    marks = marksOf(REACHED);
    await stub.broadcast(pendingMessage(exact));
    // The legacy node keeps it without decrypting; ENTRY gets past the length
    // and refuses it only at the decrypt, as the string is no ciphertext.
    const legacy = await pendingVerdict(env.clients[LEGACY], exact.hash, refusedFor(exact.hash), {
      afterId: marks[LEGACY], label: 'the legacy node\'s verdict on the enterprise string of exactly its length',
    });
    expect(legacy, JSON.stringify(legacy)).to.deep.equal({ stored: true });
    const entry = await pendingVerdict(env.clients[ENTRY], exact.hash, refusedFor(exact.hash), {
      afterId: marks[ENTRY], label: 'ENTRY\'s verdict on the enterprise string of exactly its length',
    });
    expect(entry, JSON.stringify(entry)).to.have.nested.property('refused.reason').that.does.not.include('too long');
  });

  // The stub already holds a connection with ENTRY on 16127, so it dials on the
  // other allowed ports, and on one that is not allowed.
  it('refuses connections that never finish their handshake past the inbound limit, and on a port not allowed', async function () {
    this.timeout(120000);
    const allowed = [16137, 16147, 16157, 16167, 16177, 16187, 16197];
    const results = await stub.dialAndHold(`${getSubnetConfig().nodeIp(ENTRY + 1)}:16127`, [...allowed, 16128], { holdMs: 3000 });
    const at = (port) => results.find((r) => r.port === port);

    expect(at(16128).closeCode, JSON.stringify(results)).to.equal(4021);
    const onAllowed = allowed.map(at);
    const refused = onAllowed.filter((r) => r.closeCode !== null);
    const held = onAllowed.filter((r) => r.closeCode === null);
    expect(refused.length, `connections refused at the inbound limit: ${JSON.stringify(results)}`).to.be.at.least(1);
    refused.forEach((r) => expect(r.closeCode, JSON.stringify(r)).to.equal(4000));
    expect(held.length, `connections held, still handshaking: ${JSON.stringify(results)}`).to.be.at.least(1);
  });

  it('drops a frame its link has already carried, and takes the next', async function () {
    this.timeout(300000);
    const first = await buildSeedableApp({ env, name: name('replay'), instances: 1 });
    await stub.broadcast(pendingMessage(first));
    await waitFor(() => storedOn(ENTRY, first.hash), { timeout: 120000, interval: 2000, label: 'ENTRY stored the message the stub sent over its link' });

    const mark = env.clients[ENTRY].getLastEventId();
    expect(await stub.replayLastFrame(), 'frames the stub replayed').to.equal(1);
    const replayed = await waitForFirstEvent(env.clients[ENTRY], [
      { event: 'peers:frameDropped', matches: (d) => d.ip === stub.ip && d.reason === 'linkMac' },
    ], { afterId: mark, timeout: 60000, label: 'ENTRY dropped the frame the stub replayed on its link' });
    expect(replayed.data.reason).to.equal('linkMac');

    const next = await buildSeedableApp({ env, name: name('replay'), instances: 1 });
    await stub.broadcast(pendingMessage(next));
    await waitFor(() => storedOn(ENTRY, next.hash), { timeout: 120000, interval: 2000, label: 'ENTRY stored the next message the stub sent over its link' });
  });

  // Last: the connection it closes is the stub's link to ENTRY.
  it('closes a connection that sends a frame over the frame limit, unparsed', async function () {
    this.timeout(300000);
    const app = await buildSeedableApp({ env, name: name('payload'), instances: 1 });
    const mark = env.clients[ENTRY].getLastEventId();
    const sentAt = Date.now();

    await stub.broadcast({ ...pendingMessage(app), padding: 'x'.repeat(PEER_FRAME_MAX_BYTES) });

    const dropped = await env.clients[ENTRY].waitForEvent(
      'peers:frameDropped',
      (d) => d.ip === stub.ip && d.reason === 'frameLimit',
      120000,
      { afterId: mark },
    );
    expect(dropped.data.type, 'a frame over the limit is not parsed to name its type').to.equal(null);
    await env.clients[ENTRY].waitForEvent('peers:removed', (d) => d.ip === stub.ip, 60000, { afterId: mark });
    const { closes } = await stub.getStats();
    const entryIp = getSubnetConfig().nodeIp(ENTRY + 1);
    const codes = closes.filter((c) => c.ip === entryIp && c.at >= sentAt).map((c) => c.code);
    expect(codes, JSON.stringify(closes)).to.have.length(1);
    expect(codes[0], 'closed as an invalid message, inbound or outbound').to.be.oneOf([4016, 4017]);
  });
});
