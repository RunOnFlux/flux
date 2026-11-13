/*
 * A legacy node counts an unpaid message against the operator whose signature
 * admitted it, not against the client tag it carries.
 *
 * Any listed node can send a legacy node a message under any client's tag and
 * sign it as its admitting node; a legacy node cannot tell that tag from one an
 * Arcane node read from its caller. The stub peer is such a node: not Arcane,
 * peered with the legacy observer only. It sends the client allowance of
 * messages under one client's tag, each signed as admitted by itself; a message
 * under the same tag that node 2 admitted, relayed straight after, is still
 * taken. The stub's further messages under that tag are held to its own operator
 * allowance.
 */
import { describe, it, before } from 'mocha';
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
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 4;
const STUB = 3;
const OBSERVER = 1;
const ADMITTER = 2;
const CLIENT_TAG_CAP = 2;
const ORIGIN_KEY_CAP = 4;

describe('a legacy node counts an unpaid message against the operator that signed it', function () {
  let env;
  let stub;
  const stamp = Date.now();
  const stubKey = nodeKey(STUB + 1).pubkey;
  const client = freshClientTag();

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2elegacytag${appCount}x${stamp}`, instances: 1 });
  };

  // A message under the client's tag, signed as admitted by `admitter`, or by the
  // stub itself when none is given; the observer's decision on it, and once it
  // was taken, the message held.
  const sendUnderTag = async (admitter) => {
    const app = await unpaidApp();
    const admitted = { clientTag: client, clientTagHeight: await currentTagHeight() };
    const fields = admitter
      ? { ...admitted, origin: await admittingSignature(pendingMessage(app, admitted), admitter) }
      : admitted;
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(pendingMessage(app, fields));
    const decision = await admissionOf(env.clients[OBSERVER], app.hash, mark);
    if (decision.taken) {
      await waitFor(async () => (await pendingMessageOn(env.clients[OBSERVER], app.hash)) !== null, {
        timeout: 30000, interval: 1000, label: `${app.hash} held by the observer`,
      });
    }
    return decision;
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      legacyNodes: [OBSERVER],
      stubPeers: [STUB],
      stubPeeredWith: { [STUB]: [OBSERVER] },
      configOverrides: { fluxapps: { clientTagCap: CLIENT_TAG_CAP, originKeyCap: ORIGIN_KEY_CAP } },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.connectedNodes()) >= 1, {
      timeout: 120000, interval: 2000, label: 'the legacy observer connected to the stub peer',
    });
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('takes a message another node admitted under a client tag a sender has used up', async function () {
    this.timeout(300000);
    for (let i = 0; i < CLIENT_TAG_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const decision = await sendUnderTag();
      expect(decision, `the stub's message ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, clientTag: client, originKey: stubKey });
    }

    const decision = await sendUnderTag(nodeKey(ADMITTER + 1));

    expect(decision, JSON.stringify(decision)).to.include({ taken: true, clientTag: client, originKey: nodeKey(ADMITTER + 1).pubkey });
  });

  it('holds a sender using another client\'s tag to its own operator allowance', async function () {
    this.timeout(300000);
    for (let i = CLIENT_TAG_CAP; i < ORIGIN_KEY_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const decision = await sendUnderTag();
      expect(decision, `the stub's message ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, originKey: stubKey });
    }

    const decision = await sendUnderTag();

    expect(decision.taken, JSON.stringify(decision)).to.equal(false);
    expect(decision.reason).to.equal(`its admitting operator already has ${ORIGIN_KEY_CAP} unpaid app messages pending`);
  });
});
