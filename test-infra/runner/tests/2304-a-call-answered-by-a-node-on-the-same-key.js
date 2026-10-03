// weight: medium
import crypto from 'node:crypto';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { redirectOutbound, clearOutboundRedirect } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { verifyBtcMessage } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// One operator's nodes behind one router, on one key. A call from outside to
// one of them lands on the other, which answers truthfully as itself - with the
// key the dialled node is listed under. The key says the answer came from one
// of that operator's nodes; only the address the answer signs says which.
//
// Three nodes, one API port each (16127). B and C share a key. A's calls to B
// are moved to C by a DNAT in A's own OUTPUT chain; its calls to C are not.

const A = 0;
const B = 1;
const C = 2;

// Calls between nodes: the API port, the UI port beside it, and syncthing's.
const FLUX_PORTS = '16127:16129';

// The outbound check, which dials observers afresh, runs on this interval.
const CHECK_INTERVAL_MS = 10000;

describe('a call to one node answered by another node on the same key', function () {
  let env;
  let redirectRules = [];
  dumpLogsOnFailure(() => env);

  const addr = (i) => `${env.clients[i].ip}:16127`;
  const verdicts = async () => ({
    misroutedB: await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'misrouted'),
    verifiedB: await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified'),
    verifiedC: await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(C), 'verified'),
  });

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      sharedKeys: { [C + 1]: B + 1 },
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

  it('has B and C answer who they are with one key, each at its own address', async function () {
    this.timeout(60000);
    const answers = await Promise.all([B, C].map(async (i) => {
      const challenge = crypto.randomBytes(16).toString('hex');
      const res = await env.clients[i].post('/flux/identity', { challenge });
      expect(res.status, `node ${i} refused: ${JSON.stringify(res.data)}`).to.equal('success');
      const { signature, ...signed } = res.data;
      expect(signed.socketAddress).to.equal(addr(i));
      expect(verifyBtcMessage(JSON.stringify(signed), signature, env.nodeKeyOf(env.clients[i].num).pubkey),
        `node ${i}'s signature does not verify against the key it is listed under`).to.equal(true);
      return signed;
    }));
    expect(answers[0].pubKey, 'B and C are on one key').to.equal(answers[1].pubKey);
  });

  it('has A verify B and C each at its own address', async function () {
    this.timeout(180000);
    const baseline = await verdicts();
    await waitFor(async () => {
      const now = await verdicts();
      return now.verifiedB > baseline.verifiedB && now.verifiedC > baseline.verifiedC;
    }, { timeout: 150000, interval: 5000, label: 'node A has verified both B and C' });
  });

  describe('A\'s calls to B landing on C', () => {
    let baseline;

    before(async function () {
      this.timeout(60000);
      baseline = await verdicts();
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

    it('finds the call to B answered by C, and the call to C answered by C', async function () {
      this.timeout(300000);
      await waitFor(async () => {
        const now = await verdicts();
        return now.misroutedB > baseline.misroutedB && now.verifiedC > baseline.verifiedC;
      }, { timeout: 240000, interval: 5000, label: 'node A has dialled both observers since the redirect' });
    });

    it('never takes C\'s answer as B\'s', async function () {
      this.timeout(30000);
      const now = await verdicts();
      expect(now.verifiedC, 'A dialled C since the redirect').to.be.above(baseline.verifiedC);
      expect(now.verifiedB, 'A judged an answer from C as B\'s').to.equal(baseline.verifiedB);
    });
  });
});
