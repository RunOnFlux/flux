// weight: medium
import crypto from 'node:crypto';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, seedSpawnerApp, waitForInstanceCount } from '../framework/reconciler-suite.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { redirectOutbound, clearOutboundRedirect } from '../framework/container.js';
import { assertNoEvent, waitFor } from '../framework/wait.js';
import { nodeKey } from '../framework/keys.js';
import { verifyBtcMessage } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Some routers forward a port by number alone, to the node behind them, whatever
// address the traffic is for - outgoing traffic included. Inbound is unaffected,
// so the node passes every reachability check, while every call it makes on that
// port to another Flux node arrives back inside its own network and is answered
// there, truthfully, by the wrong node.
//
// The fault is reproduced where it lives: a DNAT in one node's own OUTPUT chain,
// so only the calls that node originates are moved. What the node does about it
// is the product under test, end to end: the signed identity every node serves,
// the check that dials an observer on this node's own API port, the verdict it
// reaches from two observers on distinct IPs, the synced apps it stops taking
// while the verdict stands, and the verdict clearing.
//
// Three nodes, one API port each (16127), so any other node is an observer on
// the redirected node's own port and the redirect is exactly the one a
// port-forwarding router makes.

const A = 0;
const B = 1;
const C = 2;

// Calls between nodes: the API port, the UI port beside it, and syncthing's.
const FLUX_PORTS = '16127:16129';

// The check runs on this interval. Production's is ten minutes; the rule is
// two witnesses and one clearance, whatever the cadence.
const CHECK_INTERVAL_MS = 10000;

// Observers on distinct IPs that must answer as another node before a node is
// called redirected.
const REDIRECT_WITNESSES = 2;

describe('a call to one node answered by another', function () {
  let env;
  let redirectRules = [];
  dumpLogsOnFailure(() => env);

  const addr = (i) => `${env.clients[i].ip}:16127`;
  const outboundPath = async (i) => (await env.clients[i].get('/flux/outboundpath')).data;
  // Outbound checks a node has run, whatever each found.
  const checksRun = async (i) => Object.values((await env.clients[i].getTestCounters())?.['outboundPath:check'] ?? {})
    .reduce((sum, n) => sum + n, 0);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        // Three nodes can only carry minOutgoing 1 - the discovery ring needs
        // 2*minOutgoing+1 to close.
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          outboundPathCheckIntervalMs: CHECK_INTERVAL_MS,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    if (env && redirectRules.length) await clearOutboundRedirect(env.clients[A].container, redirectRules).catch(() => {});
    await env?.teardown();
  });

  it('has every node answer who it is, signed by its own key over the caller\'s challenge', async function () {
    this.timeout(60000);
    await Promise.all(env.clients.map(async (client, i) => {
      const challenge = crypto.randomBytes(16).toString('hex');
      const res = await client.post('/flux/identity', { challenge });

      expect(res.status, `node ${i} refused: ${JSON.stringify(res.data)}`).to.equal('success');
      const { signature, ...signed } = res.data;
      expect(signed.purpose).to.equal('fluxnodeIdentity');
      expect(signed.challenge, 'an answer to some other challenge is a recording').to.equal(challenge);
      expect(signed.socketAddress).to.equal(addr(i));
      expect(signed.pubKey).to.equal(nodeKey(client.num).pubkey);
      expect(verifyBtcMessage(JSON.stringify(signed), signature, nodeKey(client.num).pubkey),
        `node ${i}'s signature does not verify against its own key`).to.equal(true);
    }));
  });

  it('refuses to sign anything but a fresh challenge', async function () {
    this.timeout(30000);
    const res = await env.clients[A].post('/flux/identity', { challenge: '{"target":"10.0.0.1:16127"}' });

    expect(res.status).to.equal('error');
  });

  it('has every node find that its calls reach the node it dialled', async function () {
    this.timeout(180000);
    // The canary for everything below: the check runs on this fleet, and an
    // observer answering as itself clears the path.
    await Promise.all(env.clients.map((client) => client.waitForEvent('outboundPath:clear', () => true, 150000)));
    const states = await Promise.all(env.clients.map((_c, i) => outboundPath(i)));
    states.forEach((state, i) => expect(state.state, `node ${i}`).to.equal('clear'));
  });

  describe('a node whose router sends its calls back to itself', () => {
    let anchor;
    let othersAnchor;
    let othersChecked;

    before(async function () {
      this.timeout(60000);
      anchor = env.clients[A].getLastEventId();
      othersAnchor = [B, C].map((i) => env.clients[i].getLastEventId());
      othersChecked = await Promise.all([B, C].map(checksRun));
      redirectRules = await redirectOutbound(env.clients[A].container, {
        toIps: [env.clients[B].ip, env.clients[C].ip],
        ports: FLUX_PORTS,
        landsOn: env.clients[A].ip,
      });
    });

    it('proves the redirect from two observers answering as itself', async function () {
      this.timeout(180000);
      const event = await env.clients[A].waitForEvent('outboundPath:redirected', () => true, 150000, { afterId: anchor });

      expect(event.data.port).to.equal(16127);
      const dialled = event.data.witnesses.map((w) => w.dialled).sort();
      expect(dialled).to.deep.equal([addr(B), addr(C)].sort());
      event.data.witnesses.forEach((w) => expect(w.answeredAs, `a call to ${w.dialled}`).to.equal(addr(A)));

      const state = await outboundPath(A);
      expect(state.state).to.equal('redirected');
    });

    it('keeps a synced app off that node, and the app lands on the others', async function () {
      this.timeout(420000);
      const appName = `e2eredirsync${Date.now()}`;
      await pushTestApp(appName);
      const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });
      const spawnAnchor = env.clients[A].getLastEventId();
      await seedSpawnerApp(env, app);

      await env.clients[A].waitForEvent('spawner:deferred',
        (d) => d.appName === appName && d.reason === 'outbound_redirected', 240000, { afterId: spawnAnchor });
      const holders = await waitForInstanceCount(env, appName, 2, { timeout: 300000, stableMs: 15000 });
      expect(holders, 'the redirected node took the synced app').to.deep.equal([B, C]);
    });

    it('leaves the nodes it cannot reach alone - their calls reach it, and theirs are not redirected', async function () {
      this.timeout(120000);
      // Each has run REDIRECT_WITNESSES checks of its own since A's router went in,
      // enough to have called itself redirected had its calls gone astray too.
      await Promise.all([B, C].map((i, k) => waitFor(
        async () => (await checksRun(i)) >= othersChecked[k] + REDIRECT_WITNESSES,
        { timeout: 90000, interval: 2000, label: `node ${i} ran ${REDIRECT_WITNESSES} outbound checks since the redirect` },
      )));
      await Promise.all([B, C].map((i, k) => assertNoEvent(env.clients[i], 'outboundPath:redirected', () => true,
        0, { afterId: othersAnchor[k] })));
      const states = await Promise.all([B, C].map((i) => outboundPath(i)));
      states.forEach((state) => expect(state.state).to.equal('clear'));
    });

    it('takes nothing out of service while the verdict stands', async function () {
      this.timeout(30000);
      await assertNoEvent(env.clients[A], 'dos:changed', (d) => d.dosState >= 100, 0, { afterId: anchor });
    });

    it('clears the verdict once its calls reach other nodes again', async function () {
      this.timeout(180000);
      const released = env.clients[A].getLastEventId();
      await clearOutboundRedirect(env.clients[A].container, redirectRules);
      redirectRules = [];

      const clear = await env.clients[A].waitForEvent('outboundPath:clear',
        (d) => d.previous === 'redirected', 150000, { afterId: released });
      expect([addr(B), addr(C)]).to.include(clear.data.observer);
      expect((await outboundPath(A)).state).to.equal('clear');
    });
  });

  // One address answered by another node, and every other address answered by
  // the node dialled. Not a port-forwarding router - so the calls to that one
  // address are refused, and the node is not called redirected for it.
  describe('a node whose calls to one address reach a different node', () => {
    let anchor;
    let baseline;

    const verdicts = async () => ({
      misroutedB: await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'misrouted'),
      verifiedC: await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(C), 'verified'),
    });

    before(async function () {
      this.timeout(60000);
      baseline = await verdicts();
      anchor = env.clients[A].getLastEventId();
      redirectRules = await redirectOutbound(env.clients[A].container, {
        toIps: [env.clients[B].ip],
        ports: FLUX_PORTS,
        landsOn: env.clients[C].ip,
      });
    });

    after(async function () {
      this.timeout(30000);
      await clearOutboundRedirect(env.clients[A].container, redirectRules).catch(() => {});
      redirectRules = [];
    });

    it('finds the call to that address answered by the other node, and the call to the other node answered by it', async function () {
      this.timeout(300000);
      await waitFor(async () => {
        const now = await verdicts();
        return now.misroutedB > baseline.misroutedB && now.verifiedC > baseline.verifiedC;
      }, { timeout: 240000, interval: 5000, label: 'node A has dialled both observers since the redirect' });
    });

    it('does not call the node redirected on one address\'s evidence', async function () {
      this.timeout(60000);
      await assertNoEvent(env.clients[A], 'outboundPath:redirected', () => true, 0, { afterId: anchor });
      expect((await outboundPath(A)).state).to.equal('clear');
    });
  });
});
