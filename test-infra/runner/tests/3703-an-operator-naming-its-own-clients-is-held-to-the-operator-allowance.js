/*
 * An operator that names its own clients is held to the operator allowance.
 *
 * A node can put any tag it likes on a message it admits, so a tag alone does not
 * hold back an operator that invents a fresh client for every message. What
 * does is the admitting frame: every node counts unpaid messages per key that
 * admitted them. The stub peer is a listed node admitting messages itself, each
 * with a tag no client has. The allowance is 3: three are taken, the fourth is
 * refused for its operator. A message node 2 admitted, relayed by the same stub
 * straight after, is taken: the refusal is the stub's operator's, not the
 * relay's.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, admittingSignature, admissionOf, pendingMessageOn,
} from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
const STUB = 3;
const REAL = [0, 1, 2];
const OBSERVER = 1;
const OTHER_ADMITTER = 2;
const ORIGIN_KEY_CAP = 3;

describe('an operator naming its own clients is held to the operator allowance', function () {
  let env;
  let stub;
  const stamp = Date.now();
  const stubKey = nodeKey(STUB + 1).pubkey;

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2eoperator${appCount}x${stamp}`, instances: 1 });
  };

  const admitAsStub = async () => {
    const app = await unpaidApp();
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() }));
    return { app, decision: await admissionOf(env.clients[OBSERVER], app.hash, mark) };
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      configOverrides: { fluxapps: { originKeyCap: ORIGIN_KEY_CAP } },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.connectedNodes()) >= REAL.length, {
      timeout: 120000, interval: 2000, label: 'every real node connected to the stub peer',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes an operator\'s messages up to the allowance, each under the operator\'s key', async function () {
    this.timeout(180000);
    for (let i = 0; i < ORIGIN_KEY_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { app, decision } = await admitAsStub();
      expect(decision, `message ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, originKey: stubKey });
      // held, so counted: a message taken and then failing verification would leave the allowance unspent
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await pendingMessageOn(env.clients[OBSERVER], app.hash)) !== null, {
        timeout: 30000, interval: 1000, label: `message ${i} held by the observer`,
      });
    }
  });

  it('refuses the operator\'s next message, though its client tag is new', async function () {
    this.timeout(60000);
    const { decision } = await admitAsStub();

    expect(decision.taken, JSON.stringify(decision)).to.equal(false);
    expect(decision.reason).to.equal(`its admitting operator already has ${ORIGIN_KEY_CAP} unpaid app messages pending`);
  });

  it('takes a message another node admitted, relayed by the same operator', async function () {
    this.timeout(60000);
    const app = await unpaidApp();
    const admitted = { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() };
    const origin = await admittingSignature(pendingMessage(app, admitted), nodeKey(OTHER_ADMITTER + 1));
    const mark = env.clients[OBSERVER].getLastEventId();

    await stub.broadcast(pendingMessage(app, { ...admitted, origin }));

    const decision = await admissionOf(env.clients[OBSERVER], app.hash, mark);
    expect(decision, JSON.stringify(decision)).to.include({ taken: true, originKey: nodeKey(OTHER_ADMITTER + 1).pubkey });
  });
});
