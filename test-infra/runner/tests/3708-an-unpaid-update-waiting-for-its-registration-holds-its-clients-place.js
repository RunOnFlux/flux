/*
 * An unpaid update waiting for its app's registration holds its client's place in
 * the allowance.
 *
 * A node that holds no earlier version of an app parks an update for it until the
 * registration is stored, and stores nothing meanwhile. The stub peer is a listed
 * Arcane node admitting messages itself under one client tag, and the client's
 * allowance is 2. Two updates for apps no node has registered are taken and
 * parked; the client's next message, a registration, is refused because the two
 * waiting updates hold its places. A registration under another tag is taken
 * through the same stub, so the refusal is the client's.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, admissionOf, pendingMessageOn,
} from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 4;
const STUB = 3;
const OBSERVER = 1;
const CLIENT_TAG_CAP = 2;

describe('an unpaid update waiting for its registration holds its client\'s place', function () {
  let env;
  let stub;
  const stamp = Date.now();
  const client = freshClientTag();

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unregisteredApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2ewaiting${appCount}x${stamp}`, instances: 1 });
  };

  // Sends a message as the stub admitting it, and returns the observer's decision.
  const admitAsStub = async (message) => {
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(message);
    return admissionOf(env.clients[OBSERVER], message.hash, mark);
  };

  const tagged = async (clientTag) => ({ clientTag, clientTagHeight: await currentTagHeight() });

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      // Admits as an Arcane peer, over links it has authenticated.
      arcaneStubPeers: [STUB],
      configOverrides: { fluxapps: { clientTagCap: CLIENT_TAG_CAP } },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.connectedNodes()) >= NODES - 1, {
      timeout: 120000, interval: 2000, label: 'every real node connected to the stub peer',
    });
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('takes and parks the client\'s updates for apps no node has registered, storing neither', async function () {
    this.timeout(180000);
    const updates = [];
    for (let i = 0; i < CLIENT_TAG_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const app = await unregisteredApp();
      // eslint-disable-next-line no-await-in-loop
      const update = await buildSeedableUpdate(app, (spec) => { spec.description = `waiting ${i}`; });
      // eslint-disable-next-line no-await-in-loop
      const message = pendingMessage(update, await tagged(client));
      // eslint-disable-next-line no-await-in-loop
      const decision = await admitAsStub(message);
      expect(decision, `update ${i}: ${JSON.stringify(decision)}`).to.include({ taken: true, clientTag: client });
      updates.push(message.hash);
    }

    const held = await Promise.all(updates.map((hash) => pendingMessageOn(env.clients[OBSERVER], hash)));
    expect(held, 'a parked update was stored').to.deep.equal(updates.map(() => null));
  });

  it('refuses the client\'s next message while its updates wait, and takes another client\'s', async function () {
    this.timeout(180000);
    const refused = await admitAsStub(pendingMessage(await unregisteredApp(), await tagged(client)));
    expect(refused.taken, JSON.stringify(refused)).to.equal(false);
    expect(refused.reason).to.equal(`its client already has ${CLIENT_TAG_CAP} unpaid app messages pending`);

    const other = pendingMessage(await unregisteredApp(), await tagged(freshClientTag()));
    const taken = await admitAsStub(other);
    expect(taken, JSON.stringify(taken)).to.include({ taken: true });
    await waitFor(async () => (await pendingMessageOn(env.clients[OBSERVER], other.hash)) !== null, {
      timeout: 30000, interval: 1000, label: 'the other client\'s registration held by the observer',
    });
  });
});
