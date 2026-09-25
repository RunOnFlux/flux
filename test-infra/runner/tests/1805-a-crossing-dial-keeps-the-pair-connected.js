// weight: heavy
/*
 * Two nodes dial each other at once, and the pair keeps the connection the lower
 * address dialed - at both ends, in every order the two dials can meet.
 *
 * Call the lower address L and the higher H, L's dial X and H's dial Y. A
 * crossing reaches each end in one of three orders, and this suite forces each
 * with packet holds rather than waiting for the network to produce it:
 *
 *   1. X completes at both ends before Y opens. L holds X when Y arrives (the
 *      inbound path decides); H holds X when Y opens (the outbound path).
 *   2. Y completes at both ends before X opens - the mirror.
 *   3. Both dials reach their servers before either dialer hears back, and each
 *      end decides while still holding the other's dial, before it hears the
 *      other end's verdict. This is the order in which a rule each end applies
 *      to the order IT saw - keeping whichever connection established first -
 *      has L and H each keep a different connection and close the one the
 *      other kept, leaving the pair with nothing.
 *
 * (The fourth combination - L holding X first while H holds Y first - needs
 * each dial to complete before the other began, which cannot happen.)
 *
 * Every case must end with L holding X as its outbound connection and H holding
 * it as inbound, alive and alone, after longer than the inbound path's deferred
 * duplicate refusal takes to land; and each node's `peers:crossing` counter must
 * show the decisions the case forces, so a case that never crossed cannot pass.
 *
 * Both openings are held before either node is asked to dial, so no
 * connection can form until both have initiated theirs, whichever request
 * reached its node first; each case then releases them in the order it tests.
 * Discovery is quietened after the fleet has peered (discoveryRetryMs), so the
 * only dials between L and H are the ones each case makes.
 */
import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { fluxTeamKey } from '../framework/keys.js';
import { hold, release, releaseAll } from '../framework/packet-hold.js';
import { authenticate } from '../auth.js';

const API_PORT = 16127;
// Longer than the inbound path's deferred duplicate refusal (1s) plus the close
// handshake, so a connection that is going to be dropped has been dropped.
const SETTLE_MS = 2500;
// A held opening is retransmitted at 1s and then 3s after the dial began, inside
// the harness's 5s handshake timeout; every wait on a held dial fits in that.
const HOLD_BUDGET_MS = 4000;

const octets = (ip) => ip.split('.').map(Number);
const lowerIp = (a, b) => {
  const [x, y] = [octets(a), octets(b)];
  for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

describe('a crossing dial keeps the connection the lower address dialed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let low;
  let high;
  const auth = new Map();

  const call = async (client, path) => {
    const res = await fetch(`${client.url}${path}`, { headers: { zelidauth: auth.get(client) } });
    return res.json();
  };
  // What `client` holds with `other`: its entries for that address, by direction.
  const heldWith = async (client, other) => {
    const { outbound, inbound } = await client.getTestState('peers');
    return {
      outbound: outbound.filter((p) => p.ip === other.ip),
      inbound: inbound.filter((p) => p.ip === other.ip),
    };
  };
  const holdsAs = async (client, other, direction) => (await heldWith(client, other))[direction]
    .some((p) => p.alive);
  const crossings = async (client) => ({ ...((await client.getTestCounters())['peers:crossing'] ?? {}) });
  const delta = (after, before) => Object.fromEntries(Object.keys({ ...after, ...before })
    .map((k) => [k, (after[k] ?? 0) - (before[k] ?? 0)])
    .filter(([, n]) => n !== 0));
  const decisions = (d) => Object.values(d).reduce((sum, n) => sum + n, 0);

  async function disconnectPair() {
    await Promise.all([
      call(low, `/flux/removepeer/${high.ip}:${API_PORT}`),
      call(low, `/flux/removeincomingpeer/${high.ip}:${API_PORT}`),
      call(high, `/flux/removepeer/${low.ip}:${API_PORT}`),
      call(high, `/flux/removeincomingpeer/${low.ip}:${API_PORT}`),
    ]);
    await waitFor(async () => {
      const [l, h] = [await heldWith(low, high), await heldWith(high, low)];
      return !l.outbound.length && !l.inbound.length && !h.outbound.length && !h.inbound.length;
    }, { timeout: 15000, interval: 200, label: 'the pair holds no connection' });
  }

  // Both nodes initiate their dial while both openings are held, so neither dial
  // can complete before the other has been made. Returns the two holds: X's
  // opening (held at H) and Y's (held at L).
  async function dialBothHeld() {
    const holds = await Promise.all([
      hold(high, { from: low.ip, dport: API_PORT, syn: true }),
      hold(low, { from: high.ip, dport: API_PORT, syn: true }),
    ]);
    await dialBoth();
    return { xOpening: holds[0], yOpening: holds[1] };
  }

  async function dialBoth() {
    const [fromLow, fromHigh] = await Promise.all([
      call(low, `/flux/addpeer/${high.ip}:${API_PORT}`),
      call(high, `/flux/addpeer/${low.ip}:${API_PORT}`),
    ]);
    expect(fromLow.status, `L initiates its dial: ${JSON.stringify(fromLow)}`).to.equal('success');
    expect(fromHigh.status, `H initiates its dial: ${JSON.stringify(fromHigh)}`).to.equal('success');
  }

  // The one outcome every order must reach: X, alone and alive, at both ends.
  async function expectXHeld() {
    await waitFor(async () => (await holdsAs(low, high, 'outbound')) && (await holdsAs(high, low, 'inbound')),
      { timeout: 10000, interval: 200, label: "L's dial held at both ends" });
    await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS); });
    const [l, h] = [await heldWith(low, high), await heldWith(high, low)];
    expect(l.inbound, 'L holds no connection H dialed').to.deep.equal([]);
    expect(h.outbound, 'H holds no connection it dialed').to.deep.equal([]);
    expect(l.outbound.map((p) => p.alive), 'L holds exactly its own dial, alive').to.deep.equal([true]);
    expect(h.inbound.map((p) => p.alive), "H holds exactly L's dial, alive").to.deep.equal([true]);
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      // Peer once at boot, then never again on its own: every later dial between
      // L and H is one a case made.
      configOverrides: { fluxapps: { discoveryRetryMs: 24 * 60 * 60 * 1000 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    const [a, b] = env.clients;
    [low, high] = lowerIp(a.ip, b.ip) ? [a, b] : [b, a];
    for (const client of [low, high]) {
      // eslint-disable-next-line no-await-in-loop
      auth.set(client, (await authenticate(client.url, fluxTeamKey())).zelidauth);
    }
    // The rule orders the pair by the addresses the nodes know themselves by.
    await waitFor(async () => (await low.getTestState('peers')).self === `${low.ip}:${API_PORT}`
      && (await high.getTestState('peers')).self === `${high.ip}:${API_PORT}`,
    { timeout: 60000, interval: 1000, label: 'both nodes know their own address' });
  });

  afterEach(async function () {
    this.timeout(30000);
    if (low && high) await Promise.all([releaseAll(low), releaseAll(high)]);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it("keeps L's dial when it completes at both ends before H's opens", async function () {
    this.timeout(120000);
    await disconnectPair();
    const [lowBefore, highBefore] = [await crossings(low), await crossings(high)];
    const { xOpening, yOpening } = await dialBothHeld();
    await release(xOpening);
    await waitFor(async () => (await holdsAs(low, high, 'outbound')) && (await holdsAs(high, low, 'inbound')),
      { timeout: HOLD_BUDGET_MS, interval: 50, label: 'X up at both ends while Y is held' });
    await release(yOpening);

    await expectXHeld();
    expect(delta(await crossings(low), lowBefore), 'L met Y holding X, and kept X').to.deep.equal({ outbound: 1 });
    expect(decisions(delta(await crossings(high), highBefore)), 'H decided at most once').to.be.at.most(1);
  });

  it("keeps L's dial when H's completes at both ends first", async function () {
    this.timeout(120000);
    await disconnectPair();
    const [lowBefore, highBefore] = [await crossings(low), await crossings(high)];
    const { xOpening, yOpening } = await dialBothHeld();
    await release(yOpening);
    await waitFor(async () => (await holdsAs(high, low, 'outbound')) && (await holdsAs(low, high, 'inbound')),
      { timeout: HOLD_BUDGET_MS, interval: 50, label: 'Y up at both ends while X is held' });
    await release(xOpening);

    await expectXHeld();
    expect(delta(await crossings(high), highBefore), 'H met X holding Y, and took X').to.deep.equal({ inbound: 1 });
    expect(decisions(delta(await crossings(low), lowBefore)), 'L decided at most once').to.be.at.most(1);
  });

  it("keeps L's dial when both ends decide before hearing the other's verdict", async function () {
    this.timeout(120000);
    await disconnectPair();
    const [lowBefore, highBefore] = [await crossings(low), await crossings(high)];
    // Each server's reply to the other's dial, held, so both servers accept
    // before either dialer opens.
    const xReply = await hold(low, { from: high.ip, sport: API_PORT, syn: false });
    const yReply = await hold(high, { from: low.ip, sport: API_PORT, syn: false });
    const { xOpening, yOpening } = await dialBothHeld();
    await Promise.all([release(xOpening), release(yOpening)]);
    await waitFor(async () => (await holdsAs(low, high, 'inbound')) && (await holdsAs(high, low, 'inbound')),
      { timeout: HOLD_BUDGET_MS, interval: 50, label: "both servers hold the other's dial" });
    // Each dialer's frames toward the other's server, held, so neither end hears
    // the other close anything until both have decided.
    await Promise.all([
      hold(high, { from: low.ip, dport: API_PORT, syn: false }),
      hold(low, { from: high.ip, dport: API_PORT, syn: false }),
    ]);
    await Promise.all([release(xReply), release(yReply)]);
    await waitFor(async () => decisions(delta(await crossings(low), lowBefore)) > 0
      && decisions(delta(await crossings(high), highBefore)) > 0,
    { timeout: HOLD_BUDGET_MS, interval: 50, label: "each end decides while holding the other's dial" });
    await Promise.all([releaseAll(low), releaseAll(high)]);

    await expectXHeld();
    expect(delta(await crossings(low), lowBefore), 'L kept its own dial').to.deep.equal({ outbound: 1 });
    expect(delta(await crossings(high), highBefore), "H kept L's dial").to.deep.equal({ inbound: 1 });
  });
});
