// upgrades-from: v8.22.0
/*
 * A message whose first copy is forged still arrives: the node drops every copy
 * that comes while the forged one is verified, keeps their senders, and asks
 * them once it fails.
 *
 * The fleet is a triangle of SUBJECT, RELAY on this build, and RELEASED on 8.22.0,
 * and a stub that only SUBJECT dials. Each case fixes the order with the checkpoint
 * before verification: the stub's forged copy is held there while the genuine copy
 * arrives, so that copy is dropped and only its sender remains. The message is a
 * team broadcast, whose content the test chooses, so the forgery can come first.
 *
 *   - RELAY creates the message. It keeps what it creates, so it answers when asked
 *     and SUBJECT's path names it, though RELEASED also relays the message.
 *   - RELEASED creates the message. 8.22.0 keeps nothing it creates, so it cannot
 *     answer and SUBJECT fetches from RELAY, which relayed it.
 *
 * The harness shows the order of events on real 8.22.0 and current nodes. It does
 * not show mainnet latency.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { fileURLToPath } from 'node:url';
import objectHash from 'object-hash';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { nodeKey } from '../framework/keys.js';
import { upgradeBase } from '../framework/upgrade-base.js';

const { tag: BASE_TAG } = upgradeBase(fileURLToPath(import.meta.url));

const RELEASED = 0;
const SUBJECT = 1;
const RELAY = 2;
const STUB = 3;
const BEFORE_VERIFY = 'gossip:beforeVerify';

describe('a message whose first copy is forged arrives from a peer that holds it', function () {
  let env;
  let stub;
  dumpLogsOnFailure(() => env);

  const ipChange = (n) => ({
    type: 'fluxipchanged',
    version: 1,
    oldIP: `203.0.113.${n}:16127`,
    newIP: `203.0.113.${n + 100}:16127`,
    broadcastedAt: Date.now(),
  });

  /**
   * The stub's forged copy reaches SUBJECT and is held at verification, the origin
   * creates the message, and SUBJECT keeps the origin as a sender. Released, the
   * forged copy fails.
   * @param {number} origin
   * @param {object} message
   * @param {function(): Promise<void>} [whileHeld] What must happen before release.
   * @returns {Promise<{hops: Array, verified: boolean}>} The path SUBJECT took it by.
   */
  async function forgedFirst(origin, message, whileHeld = async () => {}) {
    const subject = env.clients[SUBJECT];
    const key = objectHash(message);
    const originIp = getSubnetConfig().nodeIp(origin + 1);
    const from = subject.getLastEventId();
    await subject.holdCheckpoint(BEFORE_VERIFY, key);
    try {
      expect((await stub.forgeBroadcast(message)).sent).to.equal(1);
      await subject.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_VERIFY && d.key === key, 30000, { afterId: from });

      const answer = await env.clients[origin].broadcastMessage(message, env.clients[origin].zelidauth);
      expect(answer.data.status, `the broadcast from node ${origin}: ${JSON.stringify(answer.data)}`).to.equal('success');
      await waitFor(async () => (await subject.getDecisionCount('gossip:copyWhileVerifying', key, originIp)) >= 1, {
        timeout: 30000, interval: 200, label: 'the subject kept the sender of the copy that arrived while the forged one was held',
      });
      await whileHeld();
    } finally {
      await subject.releaseCheckpoint(BEFORE_VERIFY, key);
    }
    let path;
    await waitFor(async () => {
      const paths = await subject.getNetworkPaths(subject.zelidauth);
      path = paths.data.find((p) => p.hash === key);
      return Boolean(path);
    }, { timeout: 60000, interval: 500, label: 'the subject took the message, with its path, from a peer it asked' });
    return path;
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      nodeImageTags: { [RELEASED]: BASE_TAG },
      stubPeers: [STUB],
      stubPeeredWith: { [STUB]: [SUBJECT] },
      configOverrides: { fluxapps: { admissionLinkTarget: 0 } },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.getStats()).connectionsOpen === 1, {
      timeout: 60000, interval: 1000, label: 'the subject dialled the stub',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('fetches from the node that created the message, which keeps what it creates', async function () {
    this.timeout(180000);
    const path = await forgedFirst(RELAY, ipChange(1));

    expect(path.verified).to.equal(true);
    expect(path.hops).to.have.length(1);
    expect(path.hops[0].pubKey).to.equal(nodeKey(RELAY + 1).pubkey);
  });

  it('fetches from a relay when an 8.22.0 node created the message', async function () {
    this.timeout(180000);
    const message = ipChange(2);
    const from = env.clients[RELAY].getLastEventId();
    const path = await forgedFirst(RELEASED, message, () => env.clients[RELAY].waitForEvent(
      'network:ipchanged', (d) => d.oldIP === message.oldIP, 30000, { afterId: from },
    ));

    expect(path.verified).to.equal(true);
    expect(path.hops).to.have.length(1);
    expect(path.hops[0].pubKey).to.equal(nodeKey(RELAY + 1).pubkey);
  });
});
