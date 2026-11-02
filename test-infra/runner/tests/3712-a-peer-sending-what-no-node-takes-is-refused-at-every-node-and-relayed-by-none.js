/*
 * A peer sending what no node takes is refused by the node it reaches, and so
 * relayed by none: a broadcast over the per-message limit, an install error over
 * its length, an encrypted spec carrying a plain compose, an enterprise string
 * over its length, and a websocket message over the payload limit. A caller that
 * opens connections and never finishes their link handshake is held to the
 * node's inbound limit and to its allowed ports.
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
 * decryptrsamessage with one fixed key, which framework/enterprise-helper.js
 * encrypts with.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildSeedableApp, buildSeedableEnterpriseApp } from '../framework/seed-helper.js';
import { buildEnterpriseBlob } from '../framework/enterprise-helper.js';
import { assignPorts } from '../framework/port-allocator.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { pendingMessage, pendingMessageOn, pendingVerdict } from '../framework/unpaid-messages.js';
import { waitFor, waitForFirstEvent, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import limits from '../framework/message-limits.cjs';

const {
  GOSSIP_MESSAGE_MAX_BYTES, WS_MAX_PAYLOAD_BYTES, MAX_ENTERPRISE_LENGTH, INSTALL_ERROR_MAX_LENGTH,
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
    event: 'appmessage:refused', matches: (d) => d.hash === hash && (!reason || d.reason.includes(reason)),
  });
  const component = (componentName) => ({
    name: componentName,
    description: 'a component',
    repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
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

  it('refuses an encrypted spec carrying a plain compose, on a node that decrypts and on one that cannot', async function () {
    this.timeout(300000);
    const badName = name('plain');
    // Ported before encrypting, so what the blob decrypts to is a spec the validator takes.
    const components = [component(badName)];
    assignPorts(components, badName);
    const bad = await buildSeedableApp({
      env, name: badName, instances: 1, compose: components, enterprise: buildEnterpriseBlob(components),
    });
    const good = await buildSeedableEnterpriseApp({ env, name: name('sealed'), instances: 1 });
    const marks = marksOf(REACHED);

    await stub.broadcast(pendingMessage(bad));

    for (const i of REACHED) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await pendingVerdict(env.clients[i], bad.hash, refusedFor(bad.hash), {
        afterId: marks[i], label: `node ${i}'s verdict on the encrypted spec with a plain compose`,
      });
      expect(verdict, `node ${i}: ${JSON.stringify(verdict)}`).to.have.nested.property('refused.reason')
        .that.equals('An encrypted specification carries its compose and contacts only inside enterprise');
    }

    await stub.broadcast(pendingMessage(good));
    await storedOnEvery(good.hash, 'an encrypted spec with no plain compose, stored on every real node');
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

  // Last: the connection it closes is the stub's link to ENTRY.
  it('closes a connection that sends a websocket message over the payload limit, and drops one within it', async function () {
    this.timeout(300000);
    const app = await buildSeedableApp({ env, name: name('payload'), instances: 1 });
    const message = pendingMessage(app);
    const closed = { event: 'peers:removed', matches: (d) => d.ip === stub.ip };
    const dropped = { event: 'peers:frameDropped', matches: (d) => d.ip === stub.ip && d.type === message.type };
    const verdictOn = (mark, label) => pendingVerdict(env.clients[ENTRY], app.hash, [closed, dropped], {
      afterId: mark, timeout: 120000, label,
    });

    let mark = env.clients[ENTRY].getLastEventId();
    await stub.broadcast({ ...message, padding: 'x'.repeat(WS_MAX_PAYLOAD_BYTES - 1024 * 1024) });
    const within = await verdictOn(mark, 'ENTRY\'s verdict on a websocket message within the payload limit');
    expect(within.event, JSON.stringify(within)).to.equal('peers:frameDropped');
    await assertNoEvent(env.clients[ENTRY], 'peers:removed', closed.matches, 0, { afterId: mark });

    mark = env.clients[ENTRY].getLastEventId();
    const sentAt = Date.now();
    await stub.broadcast({ ...message, padding: 'x'.repeat(WS_MAX_PAYLOAD_BYTES) });
    const over = await verdictOn(mark, 'ENTRY\'s verdict on a websocket message over the payload limit');
    expect(over.event, JSON.stringify(over)).to.equal('peers:removed');
    // The code ENTRY closed with arrives at the stub; ENTRY's own record of a
    // connection it failed is 1006.
    const { closes } = await stub.getStats();
    const entryIp = getSubnetConfig().nodeIp(ENTRY + 1);
    expect(closes.filter((c) => c.ip === entryIp && c.at >= sentAt).map((c) => c.code), JSON.stringify(closes)).to.deep.equal([1009]);
  });
});
