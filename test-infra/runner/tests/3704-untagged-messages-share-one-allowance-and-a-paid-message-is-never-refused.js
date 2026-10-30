/*
 * Unpaid app messages without a client tag share one allowance, and a message
 * whose payment is on chain is never refused.
 *
 * A message without a tag is one admitted, or rebuilt from storage, by a release
 * that does not tag. The stub peer sends such messages as an old node would. The
 * untagged allowance is 2: two are taken, the third is refused.
 *
 * Then, with that allowance still used up, an app is paid for before any node
 * has its message. Every node sees the payment and fetches the message from its
 * peers; the stub serves it, untagged. Every node takes it and promotes it, and
 * no node asks the allowance about it: a paid message is outside it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { queueAppTx } from '../framework/daemon-control.js';
import {
  pendingMessage, pendingMessageOn, admissionOf,
} from '../framework/unpaid-messages.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
const STUB = 3;
const REAL = [0, 1, 2];
const OBSERVER = 1;
const UNTAGGED_CAP = 2;

describe('untagged unpaid messages share one allowance, and a paid message is never refused', function () {
  let env;
  let stub;
  const stamp = Date.now();

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2euntagged${appCount}x${stamp}`, instances: 1 });
  };

  const sendUntagged = async () => {
    const app = await unpaidApp();
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(pendingMessage(app));
    return { app, decision: await admissionOf(env.clients[OBSERVER], app.hash, mark) };
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      configOverrides: { fluxapps: { untaggedCap: UNTAGGED_CAP } },
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

  it('takes untagged messages up to the shared allowance', async function () {
    this.timeout(180000);
    for (let i = 0; i < UNTAGGED_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { app, decision } = await sendUntagged();
      expect(decision, `message ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, clientTag: null, originKey: null });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await pendingMessageOn(env.clients[OBSERVER], app.hash)) !== null, {
        timeout: 30000, interval: 1000, label: `untagged message ${i} held by the observer`,
      });
    }
  });

  it('refuses the next untagged message', async function () {
    this.timeout(60000);
    const { decision } = await sendUntagged();

    expect(decision.taken, JSON.stringify(decision)).to.equal(false);
    expect(decision.reason).to.equal(`${UNTAGGED_CAP} unpaid app messages without a client tag are already pending`);
  });

  it('takes a paid message on every node while the allowance is used up, without asking it', async function () {
    this.timeout(240000);
    const app = await unpaidApp();
    await stub.loadMessage(app.permanentMessage);
    const marks = REAL.map((i) => env.clients[i].getLastEventId());

    await queueAppTx(app.hash);

    await waitFor(async () => {
      const promoted = await Promise.all(REAL.map((i) => env.clients[i].get(`/apps/permanentmessages/${app.hash}?_=${Date.now()}`)
        .then((r) => r.status === 'success' && r.data?.length > 0).catch(() => false)));
      return promoted.every(Boolean);
    }, { timeout: 180000, interval: 3000, label: 'the paid message promoted on every node' });
    await Promise.all(REAL.map((i) => assertNoEvent(env.clients[i], 'appmessage:admission', (d) => d.hash === app.hash, 0, { afterId: marks[i] })));
  });
});
