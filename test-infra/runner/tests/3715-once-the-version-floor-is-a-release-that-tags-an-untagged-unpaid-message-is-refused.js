// upgrades-from: v8.23.1
/*
 * Once the network's version floor is the first release that tags every unpaid
 * message it admits, an unpaid message without a client tag is refused by every
 * node, from any link.
 *
 * The harness's nodes run the release under test, so the floor cannot be raised
 * past it; the fleet declares the first release that tags to be the floor
 * itself (fluxapps.untaggedRefusedFrom), which is the state a raised floor
 * leaves. Two Arcane nodes and a legacy one on this build, one on 8.23.1 (the
 * last release that does not tag, with no links); an Arcane stub peer whose
 * links authenticate and a plain one whose links do not. An untagged message
 * from either stub, and one the 8.23.1 node registers, is refused by every node
 * on this build. The canary is a tagged message over the Arcane stub's
 * authenticated links, which both Arcane nodes take. A refused message is not
 * relayed, so every node on this build is linked to the 8.23.1 node directly.
 *
 * No node can hold admissionQuorum (10) authenticated links here, so an Arcane
 * node's door refuses a registration with 503.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { fileURLToPath } from 'node:url';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, pendingMessageOn, admissionOf,
} from '../framework/unpaid-messages.js';
import { askToBeDialed, isPeeredWith } from '../framework/peer-topology.js';
import { upgradeBase } from '../framework/upgrade-base.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const { tag: BASE_TAG } = upgradeBase(fileURLToPath(import.meta.url));

const NODES = 6;
const ARCANE = [0, 1];
const LEGACY = 2;
const REAL = [...ARCANE, LEGACY];
const RELEASED = 3;
const ARCANE_STUB = 4;
const PLAIN_STUB = 5;
// minimumFluxOSAllowedVersion in ZelBack/config/default.js.
const FLOOR = '8.18.0';
const QUORUM = 10;
// Node 0's inbound arc wraps onto the stubs, which dial nothing, so it is short
// of the inbound floor the door checks before the quorum.
const ENTRY = 1;

describe('once the version floor is a release that tags, an untagged unpaid message is refused', function () {
  let env;
  let arcaneStub;
  let plainStub;
  const stamp = Date.now();

  dumpLogsOnFailure(() => env);

  let appCount = 0;
  const unpaidApp = () => {
    appCount += 1;
    return buildSeedableApp({ env, name: `e2efloor${appCount}x${stamp}`, instances: 1 });
  };

  // Each node's decision on a message one stub sends.
  const decisionsOn = async (stub, fields = {}) => {
    const app = await unpaidApp();
    const marks = REAL.map((i) => env.clients[i].getLastEventId());
    await stub.broadcast(pendingMessage(app, fields));
    return Promise.all(REAL.map((i, at) => admissionOf(env.clients[i], app.hash, marks[at])));
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      legacyNodes: [LEGACY],
      nodeImageTags: { [RELEASED]: BASE_TAG },
      stubPeers: [ARCANE_STUB, PLAIN_STUB],
      arcaneStubPeers: [ARCANE_STUB],
      configOverrides: { fluxapps: { untaggedRefusedFrom: FLOOR, admissionQuorum: QUORUM } },
    });
    await bootAndPeer(env);
    arcaneStub = env.stubPeerClients.get(ARCANE_STUB);
    plainStub = env.stubPeerClients.get(PLAIN_STUB);
    await waitFor(async () => {
      const [arcaneStats, plainStats] = await Promise.all([arcaneStub.getStats(), plainStub.getStats()]);
      return arcaneStats.linksAuthenticatedOpen >= ARCANE.length && plainStats.connectionsOpen >= REAL.length;
    }, { timeout: 120000, interval: 2000, label: 'the Arcane stub linked to both Arcane nodes, the plain stub connected to every node' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('takes a tagged message over an authenticated link', async function () {
    this.timeout(120000);
    const decisions = await decisionsOn(arcaneStub, { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() });

    ARCANE.forEach((i) => expect(decisions[REAL.indexOf(i)], `node ${i}: ${JSON.stringify(decisions)}`).to.include({ taken: true }));
  });

  for (const [label, stubOf] of [['an authenticated', () => arcaneStub], ['an unauthenticated', () => plainStub]]) {
    it(`refuses an untagged message from ${label} link on every node`, async function () {
      this.timeout(120000);
      const decisions = await decisionsOn(stubOf());

      decisions.forEach((decision, at) => {
        expect(decision, `node ${REAL[at]}: ${JSON.stringify(decision)}`).to.include({ taken: false, reason: 'it carries no client tag' });
      });
    });
  }

  it('refuses an untagged message an 8.23.1 node registers on every node', async function () {
    this.timeout(180000);
    const released = env.clients[RELEASED];
    for (const i of REAL) await askToBeDialed(released, env.clients[i]);
    await waitFor(async () => (await Promise.all(REAL.map((i) => isPeeredWith(env.clients[i], released.ip)))).every(Boolean), {
      timeout: 60000, interval: 2000, label: 'every node on this build linked to the 8.23.1 node',
    });
    const marks = REAL.map((i) => env.clients[i].getLastEventId());
    const owner = appOwnerKey();

    const result = await registerApp(
      released.url,
      nodeKey(RELEASED + 1),
      buildAppSpec({ name: `e2efloorreleased${stamp}`, ownerKey: owner }),
      'fluxappregister',
      { ownerKey: owner },
    );

    expect(result.status, JSON.stringify(result)).to.equal('success');
    const hash = result.data;
    await waitFor(async () => (await pendingMessageOn(released, hash)) !== null, {
      timeout: 30000, interval: 1000, label: 'the 8.23.1 node holds what it registered',
    });
    const decisions = await Promise.all(REAL.map((i, at) => admissionOf(env.clients[i], hash, marks[at])));
    decisions.forEach((decision, at) => {
      expect(decision, `node ${REAL[at]}: ${JSON.stringify(decision)}`).to.include({ taken: false, reason: 'it carries no client tag' });
    });
  });

  it('refuses a registration with 503 at an Arcane node short of its quorum', async function () {
    this.timeout(60000);
    const owner = appOwnerKey();
    const result = await registerApp(
      env.clients[ENTRY].url,
      nodeKey(ENTRY + 1),
      buildAppSpec({ name: `e2efloorreg${stamp}`, ownerKey: owner }),
      'fluxappregister',
      { ownerKey: owner },
    );

    expect(result.status, JSON.stringify(result)).to.equal('error');
    expect(result.data.name).to.equal('AdmissionUnavailable');
  });
});
