// weight: light
/* global WebSocket */
import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitForDaemonReady, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The relay a browser and a wallet meet through, against a real node.
//
// The unit tests drive the handlers with a stubbed cache and a fake socket. What they
// cannot reach is the part that decides whether this works at all: the callback arrives
// through a globally mounted body parser, the browser waits on a websocket served by a
// different server to the API, and the limits are read off a socket the test does not
// own. Each of those has been wrong before in a way no stub would show.
//
// One node, because the relay is node-local: an id issued here is answered here and
// collected here, and nothing about it is gossiped.

const RATE_PER_SEC = 5;
// Paced under the issuance rate so the refusals below are the occupancy limit and not
// the rate limit. The two answer the same status with different messages, and a test
// that cannot tell them apart passes on either.
const PACE_MS = 350;
const MAX_PENDING_PER_IP = 10;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Gives every id back by leaving, and waits for the node to have seen it.
 *
 * These tests share one node and one caller, so what a test leaves held is the fill
 * the next one starts from - and a limit test that begins part-full asserts against a
 * number it did not set.
 */
async function freeAll(listeners) {
  await Promise.all(listeners.map(async (listener) => {
    listener.ws.close();
    await listener.closed;
  }));
  // The close resolves when this end sees it; the node gives the id back in its own
  // handler, which is a round trip away.
  await pause(500);
}

/** The first message a listener is sent, as the server encodes it. */
function listen(base, paymentId) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/payment/${paymentId}`);
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`listener for ${paymentId} would not open`)), { once: true });
  });
  const first = new Promise((resolve) => {
    ws.addEventListener('message', (evt) => resolve(new URLSearchParams(evt.data)), { once: true });
  });
  const closed = new Promise((resolve) => { ws.addEventListener('close', resolve, { once: true }); });
  return { ws, open, first, closed };
}

describe('the payment relay holds an id against whoever asked for it', function () {
  let env;
  let base;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    await waitForDaemonReady(env.clients[0]);
    base = `http://${getSubnetConfig().nodeIp(1)}:16127`;
  });

  after(async function () {
    this.timeout(120000);
    await env?.teardown();
  });

  // The relay's ids live in memory and nowhere else, so a restart is what gives a
  // test an empty one. Without this each test inherits whatever the last one left
  // holding - and a limit test that starts part-full fails at its first request,
  // for the previous test's reason rather than its own. That is not hypothetical:
  // it is what the unfixed-tree run did before this was here.
  beforeEach(async function () {
    this.timeout(120000);
    await env.restartNode(0);
    await waitForBootSettled(env.clients[0]);
  });

  const requestId = async () => fetch(`${base}/payment/paymentrequest`).then((r) => r.json());

  const answer = async (paymentId, txid) => fetch(
    `${base}/payment/verifypayment?paymentid=${paymentId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txid }) },
  ).then((r) => r.json());

  it('carries a transaction id from the wallet to the browser waiting on it', async function () {
    this.timeout(120000);
    const issued = await requestId();
    expect(issued.status, 'no id was issued').to.equal('success');
    const { paymentId } = issued.data;

    // Opened before the callback, which is the order a browser uses: the listener is
    // what the wallet's answer is delivered to.
    const { ws, open, first } = listen(base, paymentId);
    await open;

    // application/json, so the body reaches the handler already parsed with its stream
    // spent. A handler waiting on 'end' for one waits for ever, and the browser on the
    // socket waits out its whole timeout for a transaction id the node was given.
    const answered = await answer(paymentId, 'e2e-transaction-id');
    expect(answered.status, 'the callback was not accepted').to.equal('success');

    const message = await first;
    expect(message.get('status')).to.equal('success');
    expect(message.get('data[txid]')).to.equal('e2e-transaction-id');
    ws.close();
  });

  it('refuses a caller that already holds its fill, and frees a slot when a browser leaves', async function () {
    this.timeout(180000);
    const held = [];

    // The fill, held the way a browser holds one: an id with a listener waiting on it.
    for (let i = 0; i < MAX_PENDING_PER_IP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const issued = await requestId();
      expect(issued.status, `id ${i} was refused before the limit was reached`).to.equal('success');
      const listener = listen(base, issued.data.paymentId);
      // eslint-disable-next-line no-await-in-loop
      await listener.open;
      held.push(listener);
      // eslint-disable-next-line no-await-in-loop
      await pause(PACE_MS);
    }

    const refused = await requestId();
    expect(refused.status, 'a caller holding its fill was issued another id').to.equal('error');
    // The message, not the status: the rate limit answers the same status, and this
    // test paces itself precisely so that it is not what it meets.
    expect(refused.data.message, 'refused, but for its rate rather than what it holds')
      .to.equal('Too many pending payment requests');

    // Naming someone else does not hand a caller a fresh allowance: a node believes
    // x-forwarded-for only from a balancer it recognises, and this runner is not one,
    // so the header is ignored and the caller is still whoever opened the socket.
    const spoofed = await fetch(`${base}/payment/paymentrequest`, {
      headers: { 'x-forwarded-for': '198.51.100.77' },
    }).then((r) => r.json());
    expect(spoofed.status, 'a caller named themselves out of their own limit').to.equal('error');
    expect(spoofed.data.message).to.equal('Too many pending payment requests');

    // A browser that leaves is the only thing that can free an id nobody answered -
    // nothing else collects one, so it would otherwise hold its slot, and its asker's
    // allowance, until it expired an hour later.
    held[0].ws.close();
    await held[0].closed;
    await pause(PACE_MS);

    const afterLeaving = await requestId();
    expect(afterLeaving.status, 'the id an abandoned listener held was never given back')
      .to.equal('success');

    const last = listen(base, afterLeaving.data.paymentId);
    await last.open;
    await freeAll(held.slice(1).concat(last));
  });

  // The limit counts what a caller holds, and an answered id holds a cache slot until
  // a browser collects it. Whoever asks for an id can answer it themselves - the
  // callback is held to nothing but the id - so an answer that stopped the id counting
  // would let one caller mint without limit, and the cache evicts oldest-first.
  it('counts an id its asker answered itself', async function () {
    this.timeout(180000);
    const held = [];

    for (let i = 0; i < MAX_PENDING_PER_IP - 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const issued = await requestId();
      expect(issued.status, `id ${i} was refused before the limit was reached`).to.equal('success');
      const listener = listen(base, issued.data.paymentId);
      // eslint-disable-next-line no-await-in-loop
      await listener.open;
      held.push(listener);
      // eslint-disable-next-line no-await-in-loop
      await pause(PACE_MS);
    }

    // No listener on this one, deliberately. A browser waiting on it would collect the
    // transaction id and the delivery path would drop the id - freeing the slot for a
    // reason that is not the one under test.
    const mine = await requestId();
    expect(mine.status, 'the id to be answered was refused').to.equal('success');
    const answered = await answer(mine.data.paymentId, 'answered-by-its-asker');
    expect(answered.status, 'the callback was not accepted').to.equal('success');
    await pause(PACE_MS);

    const refused = await requestId();
    expect(refused.status, 'an id its asker answered stopped counting against them')
      .to.equal('error');
    expect(refused.data.message, 'refused for its rate rather than for what it holds')
      .to.equal('Too many pending payment requests');

    await freeAll(held);
  });
});

// The forwarding half, which needs the node to see this runner as a balancer. The
// shipped list is a set of addresses no suite can send from, so the node is told the
// fleet's gateway is one - the address a container sees for a connection from the
// host. Nothing else about the path changes.
describe('the payment relay counts the caller a balancer reports', function () {
  let env;
  let base;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 1,
      configOverrides: { fdmAddresses: [getSubnetConfig().gateway] },
    });
    await waitForDaemonReady(env.clients[0]);
    base = `http://${getSubnetConfig().nodeIp(1)}:16127`;
  });

  after(async function () {
    this.timeout(120000);
    await env?.teardown();
  });

  const asCaller = (ip) => fetch(`${base}/payment/paymentrequest`, {
    headers: { 'x-forwarded-for': ip },
  }).then((r) => r.json());

  // Every browser reaching a node through the proxy shares one socket address, so a
  // limit counting that address spends a single allowance on all of them together.
  it('holds one caller to its fill and still answers another behind the same balancer', async function () {
    this.timeout(180000);
    const CALLER = '198.51.100.60';
    const OTHER = '198.51.100.61';

    for (let i = 0; i < MAX_PENDING_PER_IP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const issued = await asCaller(CALLER);
      expect(issued.status, `id ${i} was refused before the limit was reached`).to.equal('success');
      // eslint-disable-next-line no-await-in-loop
      await pause(PACE_MS);
    }

    const refused = await asCaller(CALLER);
    expect(refused.status, 'the caller the balancer named was never held to a limit').to.equal('error');
    expect(refused.data.message, 'refused for its rate rather than for what it holds')
      .to.equal('Too many pending payment requests');

    // The assertion the whole change exists for: another caller arriving over the same
    // socket, at the same moment, is not turned away for what the first one holds.
    const other = await asCaller(OTHER);
    expect(other.status, 'everyone behind one balancer shared a single allowance')
      .to.equal('success');
  });
});
