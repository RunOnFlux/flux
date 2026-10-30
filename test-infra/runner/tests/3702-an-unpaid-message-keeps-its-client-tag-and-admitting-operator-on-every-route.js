/*
 * An unpaid app message keeps the client tag and the admitting operator it was
 * admitted with, whichever route it takes, and no node relaying it can change
 * them.
 *
 * A registration enters through node 1's door, which tags its client. Every node
 * then holds it with that tag and node 1's key as the admitting operator,
 * including node 1, which takes its own message from a peer's reply. A node
 * started later takes it through temp sync, which carries the admitting frame,
 * and holds the same two values.
 *
 * The stub peer is a listed node that relays. It sends messages with an
 * `origin`: a frame signed with node 2's key, as node 2 having admitted the
 * message. A reply putting another tag on top is stored with the tag the origin
 * signed. An origin for another message, one whose signature does not cover what
 * it carries, and one signed by a key that is no node's are each refused, as are
 * a malformed tag and a tag height two epochs old.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  TAG_EPOCH_BLOCKS, currentTagHeight, freshClientTag, pendingMessage, signedFrame, pendingMessageOn, admissionOf,
} from '../framework/unpaid-messages.js';
import { waitFor, waitForOrchestratorState } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 5;
const STUB = 3;
const LATE = 4;
const REAL = [0, 1, 2];
const ENTRY = 1;
// The node whose key signs the origins the stub carries.
const ADMITTER = 2;
const CLIENT = '198.51.100.81';

describe('an unpaid app message keeps its client tag and admitting operator on every route', function () {
  let env;
  let stub;
  let registered;
  const stamp = Date.now();
  const owner = appOwnerKey();
  const entryKey = nodeKey(ENTRY + 1).pubkey;
  const admitterKey = nodeKey(ADMITTER + 1).pubkey;

  dumpLogsOnFailure(() => env);

  const heldOn = (indices, hash) => waitFor(async () => {
    const held = await Promise.all(indices.map((i) => pendingMessageOn(env.clients[i], hash)));
    return held.every((doc) => doc !== null);
  }, { timeout: 60000, interval: 2000, label: `${hash} held by nodes ${indices}` });

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2eorigin${appCount}x${stamp}`, instances: 1 });
  };

  // The stub relays a message whose origin is node 2 admitting `admitted`.
  const relayWithOrigin = async (app, admitted, onTop = {}) => {
    const origin = await signedFrame(pendingMessage(app, admitted), nodeKey(ADMITTER + 1));
    return stub.broadcast(pendingMessage(app, { ...admitted, ...onTop, origin: JSON.stringify(origin) }));
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      deferredNodes: 1,
      // Every real node answers a state sync, so the late node's temp sync is
      // answered whichever of them it peers with.
      syncedNodes: REAL,
      configOverrides: { fdmAddresses: [getSubnetConfig().gateway] },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.connectedNodes()) >= REAL.length, {
      timeout: 120000, interval: 2000, label: 'every real node connected to the stub peer',
    });

    const result = await registerApp(
      env.clients[ENTRY].url,
      nodeKey(ENTRY + 1),
      buildAppSpec({ name: `e2eoriginreg${stamp}`, ownerKey: owner }),
      'fluxappregister',
      { ownerKey: owner, headers: { 'x-forwarded-for': CLIENT } },
    );
    expect(result.status, JSON.stringify(result)).to.equal('success');
    registered = result.data;
    await heldOn(REAL, registered);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('every node holds a registration with its client tag and the entry node as its admitting operator', async () => {
    const docs = await Promise.all(REAL.map((i) => pendingMessageOn(env.clients[i], registered)));
    const tags = docs.map((doc) => doc.clientTag);

    expect(tags.every((tag) => /^[0-9a-f]{64}$/.test(tag)), `tags: ${tags}`).to.equal(true);
    expect(new Set(tags).size, `tags: ${tags}`).to.equal(1);
    expect(docs.map((doc) => doc.originKey)).to.deep.equal(REAL.map(() => entryKey));
  });

  it('serves the tag and the admitting operator, and not the admitting frame, on /apps/temporarymessages', async () => {
    const doc = await pendingMessageOn(env.clients[0], registered);

    expect(doc).to.include.keys('clientTag', 'clientTagHeight', 'originKey');
    expect(doc).to.not.have.property('origin');
  });

  it('a node that joins later takes it through temp sync with the same tag and admitting operator', async function () {
    this.timeout(300000);
    const { clientTag } = await pendingMessageOn(env.clients[0], registered);
    const late = await env.startNode(LATE);
    await waitForOrchestratorState(late, 'READY', 240000);
    await waitFor(async () => (await pendingMessageOn(late, registered)) !== null, {
      timeout: 60000, interval: 2000, label: 'the late node holding the registration',
    });

    const doc = await pendingMessageOn(late, registered);
    expect(doc.clientTag).to.equal(clientTag);
    expect(doc.originKey).to.equal(entryKey);
  });

  it('a relayed message carrying another tag is held with the tag its origin signed', async function () {
    this.timeout(120000);
    const app = await unpaidApp();
    const signedTag = freshClientTag();
    const clientTagHeight = await currentTagHeight();
    const mark = env.clients[ENTRY].getLastEventId();

    await relayWithOrigin(app, { clientTag: signedTag, clientTagHeight }, { clientTag: freshClientTag() });

    const decision = await admissionOf(env.clients[ENTRY], app.hash, mark);
    expect(decision, JSON.stringify(decision)).to.include({ taken: true, clientTag: signedTag, originKey: admitterKey });
    await heldOn(REAL, app.hash);
    const docs = await Promise.all(REAL.map((i) => pendingMessageOn(env.clients[i], app.hash)));
    expect(docs.map((doc) => doc.clientTag)).to.deep.equal(REAL.map(() => signedTag));
  });

  const refusals = [
    ['an origin for another message', async (app, other, clientTagHeight) => {
      const origin = await signedFrame(pendingMessage(other, { clientTag: freshClientTag(), clientTagHeight }), nodeKey(ADMITTER + 1));
      return pendingMessage(app, { origin: JSON.stringify(origin) });
    }, 'its origin is for another message'],
    ['an origin whose signature does not cover the tag it carries', async (app, other, clientTagHeight) => {
      const origin = await signedFrame(pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight }), nodeKey(ADMITTER + 1));
      origin.data.clientTag = freshClientTag();
      return pendingMessage(app, { origin: JSON.stringify(origin) });
    }, 'its origin does not verify (badSignature)'],
    ['an origin signed by a key that is no node\'s', async (app, other, clientTagHeight) => {
      const origin = await signedFrame(pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight }), owner);
      return pendingMessage(app, { origin: JSON.stringify(origin) });
    }, 'its origin does not verify (nodeNotFound)'],
    ['a malformed client tag', async (app, other, clientTagHeight) => pendingMessage(app, { clientTag: 'not-a-tag', clientTagHeight }),
      'its client tag is malformed'],
    ['a client tag height two epochs old', async (app, other, clientTagHeight) => pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight: clientTagHeight - 2 * TAG_EPOCH_BLOCKS }),
      'is not current'],
  ];

  refusals.forEach(([label, build, reason]) => {
    it(`refuses ${label}`, async function () {
      this.timeout(120000);
      const [app, other] = await Promise.all([unpaidApp(), unpaidApp()]);
      const clientTagHeight = await currentTagHeight();
      const mark = env.clients[ENTRY].getLastEventId();

      await stub.broadcast(await build(app, other, clientTagHeight));

      const decision = await admissionOf(env.clients[ENTRY], app.hash, mark);
      expect(decision.taken, JSON.stringify(decision)).to.equal(false);
      expect(decision.reason).to.include(reason);
      expect(await pendingMessageOn(env.clients[ENTRY], app.hash)).to.equal(null);
    });
  });
});
