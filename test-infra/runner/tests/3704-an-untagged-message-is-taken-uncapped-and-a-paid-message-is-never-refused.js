/*
 * An unpaid app message without a client tag is taken without a count, and a
 * message whose payment is on chain is never refused.
 *
 * A message without a tag is one admitted, or rebuilt from storage, by a release
 * that does not tag. The stub peer sends such messages as an old node would:
 * more of them than the operator allowance, every one taken, because counting
 * them would let anyone submitting through old nodes use up an allowance every
 * other client of those nodes shares.
 *
 * The allowances are live in this fleet: the stub admits two messages for one
 * client, the client allowance, and its third for that client is refused. Then an
 * app is paid for, and once every node has the payment's block the stub sends its
 * message with the same full client tag. Every node takes it and promotes it, and
 * no node asks the allowance about it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { queueAppTx } from '../framework/daemon-control.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, pendingMessageOn, admissionOf,
} from '../framework/unpaid-messages.js';
import { waitFor, waitForBlockProcessed, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 4;
const STUB = 3;
const REAL = [0, 1, 2];
const OBSERVER = 1;
const CLIENT_TAG_CAP = 2;
const ORIGIN_KEY_CAP = 3;

describe('an untagged unpaid message is taken uncapped, and a paid message is never refused', function () {
  let env;
  let stub;
  const stamp = Date.now();
  const fullClient = freshClientTag();

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2euntagged${appCount}x${stamp}`, instances: 1 });
  };

  const send = async (fields = {}) => {
    const app = await unpaidApp();
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(pendingMessage(app, fields));
    return { app, decision: await admissionOf(env.clients[OBSERVER], app.hash, mark) };
  };

  const heldByObserver = (app, label) => waitFor(async () => (await pendingMessageOn(env.clients[OBSERVER], app.hash)) !== null, {
    timeout: 30000, interval: 1000, label,
  });

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      configOverrides: { fluxapps: { clientTagCap: CLIENT_TAG_CAP, originKeyCap: ORIGIN_KEY_CAP } },
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

  it('takes untagged messages past the operator allowance, every one', async function () {
    this.timeout(240000);
    for (let i = 0; i <= ORIGIN_KEY_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { app, decision } = await send();
      expect(decision, `message ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, clientTag: null, originKey: null });
      // eslint-disable-next-line no-await-in-loop
      await heldByObserver(app, `untagged message ${i} held by the observer`);
    }
  });

  it('refuses a tagged message once its client has used its allowance', async function () {
    this.timeout(120000);
    const clientTagHeight = await currentTagHeight();
    for (let i = 0; i < CLIENT_TAG_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { app, decision } = await send({ clientTag: fullClient, clientTagHeight });
      expect(decision.taken, `message ${i}: ${JSON.stringify(decision)}`).to.equal(true);
      // eslint-disable-next-line no-await-in-loop
      await heldByObserver(app, `tagged message ${i} held by the observer`);
    }

    const { decision } = await send({ clientTag: fullClient, clientTagHeight });
    expect(decision.taken, JSON.stringify(decision)).to.equal(false);
    expect(decision.reason).to.equal(`its client already has ${CLIENT_TAG_CAP} unpaid app messages pending`);
  });

  it('takes a paid message for that client on every node, without asking the allowance', async function () {
    this.timeout(240000);
    const app = await unpaidApp();
    const { nextBlockHeight } = await queueAppTx(app.hash);
    await Promise.all(REAL.map((i) => waitForBlockProcessed(env.clients[i], (d) => d.height >= nextBlockHeight, 60000)));
    const marks = REAL.map((i) => env.clients[i].getLastEventId());

    await stub.broadcast(pendingMessage(app, { clientTag: fullClient, clientTagHeight: await currentTagHeight() }));

    await waitFor(async () => {
      const promoted = await Promise.all(REAL.map((i) => env.clients[i].get(`/apps/permanentmessages/${app.hash}?_=${Date.now()}`)
        .then((r) => r.status === 'success' && r.data?.length > 0).catch(() => false)));
      return promoted.every(Boolean);
    }, { timeout: 180000, interval: 3000, label: 'the paid message promoted on every node' });
    await Promise.all(REAL.map((i) => assertNoEvent(env.clients[i], 'appmessage:admission', (d) => d.hash === app.hash, 0, { afterId: marks[i] })));
  });
});
