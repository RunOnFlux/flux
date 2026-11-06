/*
 * Until the version floor is a release that tags, an Arcane node short of its
 * quorum of authenticated links admits a registration as a release that does not
 * tag: it writes the message without its tag and sends it to every peer, each of
 * which takes it from whatever link it arrives on.
 *
 * Four Arcane nodes and a legacy one. admissionQuorum is 10, more authenticated
 * links than any node here can hold, so every Arcane node is short of it, as the
 * first nodes to upgrade are.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { pendingMessageOn } from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 5;
const LEGACY = 4;
const REAL = [0, 1, 2, 3, LEGACY];
const ENTRY = 1;
const QUORUM = 10;

describe('before the version floor an Arcane node short of its quorum admits as a release that does not tag', function () {
  let env;
  const stamp = Date.now();
  const owner = appOwnerKey();

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      legacyNodes: [LEGACY],
      configOverrides: { fluxapps: { admissionQuorum: QUORUM } },
    });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes a registration, and every node holds it without a client tag', async function () {
    this.timeout(180000);
    const mark = env.clients[ENTRY].getLastEventId();

    const result = await registerApp(
      env.clients[ENTRY].url,
      nodeKey(ENTRY + 1),
      buildAppSpec({ name: `e2eshortquorum${stamp}`, ownerKey: owner }),
      'fluxappregister',
      { ownerKey: owner },
    );

    expect(result.status, JSON.stringify(result)).to.equal('success');
    const hash = result.data;
    const admitted = await env.clients[ENTRY].waitForEvent('appmessage:quorum', (d) => d.hash === hash, 30000, { afterId: mark });
    expect(admitted.data, JSON.stringify(admitted.data)).to.include({ committed: true, untagged: true });

    let held = [];
    await waitFor(async () => {
      held = await Promise.all(REAL.map((i) => pendingMessageOn(env.clients[i], hash)));
      return held.every((doc) => doc !== null);
    }, { timeout: 120000, interval: 2000, label: 'every node holds the registration' });
    held.forEach((doc, at) => expect(doc.clientTag ?? null, `node ${REAL[at]}`).to.equal(null));
  });
});
