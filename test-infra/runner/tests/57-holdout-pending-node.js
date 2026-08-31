import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForDaemonReady, waitForNodeStatus, waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// holdOutPendingNode refuses a node that has not started yet, with a
// one-directional INPUT drop on each running node. Its comment claims "one
// direction suffices because a connection needs both" and nothing checked it.
// Suite 71 depends on it - it moves a node's boot out of a 63 second acceptance
// window - but covers it only by going red for its own reasons when it fails.
//
// Both sides are asserted. A drop on INPUT stops the held node's SYN arriving; a
// running node dialling out still sends one and it is the REPLY that is dropped.
// So neither direction can complete, and checking only the outbound half would
// pass on a pair that connected the other way round.
//
// THE HARD PART IS THAT THIS IS A NEGATIVE, and a negative is only worth what
// its window is worth. A first version of this asserted the absence the moment
// discovery started, and passed with the drop replaced by a no-op: the node had
// not joined yet either way, so the test measured latency and called it
// isolation. The window is now calibrated by the fleet itself - the same node is
// released and timed, and the absence only counts if it was watched for
// substantially longer than joining actually takes.

const RUNNING = [0, 1, 2, 3, 4];
const PENDING = 5;

// Watched for this long while held. Must be comfortably more than a join costs,
// which the suite measures rather than assumes.
const ABSENCE_WINDOW_MS = 120000;
const CALIBRATION_FACTOR = 2;

let env;

describe('a node held out before it starts', function () {
  dumpLogsOnFailure(() => env);

  let joinMs = null;

  const peersOf = async (index) => {
    const client = env.clients[index];
    const [outbound, inbound] = await Promise.all([client.getPeers(), client.getIncomingPeers()]);
    return new Set([...(outbound.data || []), ...(inbound.data || [])]);
  };

  // Anywhere the held node and the running fleet can see each other, in either
  // direction. One set, because "is it isolated" is one question.
  const contacts = async () => {
    const heldIp = env.clients[PENDING].ip;
    const found = [];

    const held = await peersOf(PENDING);
    for (const i of RUNNING) {
      if (held.has(env.clients[i].ip)) found.push(`held node -> node ${i}`);
    }

    const seen = await Promise.all(RUNNING.map(async (i) => (await peersOf(i)).has(heldIp)));
    seen.forEach((has, idx) => { if (has) found.push(`node ${RUNNING[idx]} -> held node`); });

    return found;
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this, nodes: 6, deferredNodes: 1, tickerAutostart: false,
    });
    // Defaults, deliberately. This is the first suite to reach the framework's
    // bootAndPeer with a deferred node, and it asked for a peer that could not
    // exist until that function learned a deferred slot is a hole in the ring
    // exactly like a stub. Stating targets here would have hidden that rather
    // than fixed it, and would go stale the moment the fleet changed shape.
    await bootAndPeer(env);

    await env.holdOutPendingNode(PENDING, RUNNING);

    const joiner = await env.startNode(PENDING);
    await waitForDaemonReady(joiner);
    await waitForNodeStatus(joiner, (d) => d.confirmed === true, 60000);

    // Everyone dials, the held node included. The drop is the only reason it
    // should fail, so it is given the same chance the others got.
    await env.startDiscovery();
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('reaches nobody, and nobody reaches it, for as long as it is watched', async function () {
    this.timeout(ABSENCE_WINDOW_MS + 60000);

    const deadline = Date.now() + ABSENCE_WINDOW_MS;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const found = await contacts();
      expect(found, `the held node was not isolated: ${found.join(', ')}`).to.deep.equal([]);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 3000); });
    }
  });

  it('joins once the drop is removed', async function () {
    // What makes the absence above the DROP'S doing rather than a node that was
    // never going to peer - a broken image, a node that never confirmed, a fleet
    // that cannot dial. Same node, same fleet, the rule gone.
    this.timeout(240000);

    await env.releasePendingNode(PENDING, RUNNING);
    await env.startDiscovery();

    const started = Date.now();
    await waitFor(async () => (await contacts()).length > 0, {
      timeout: 180000,
      interval: 2000,
      label: 'the released node is peered with',
    });
    joinMs = Date.now() - started;
  });

  it('was watched for long enough that joining would have been seen', async function () {
    // The calibration, and the reason the negative above is evidence rather than
    // a measurement of latency. If a join costs anything close to the window it
    // was watched for, the absence proves nothing - and this says so instead of
    // passing quietly.
    expect(joinMs, 'the join was never timed').to.not.equal(null);
    expect(
      joinMs * CALIBRATION_FACTOR,
      `joining took ${joinMs}ms, too close to the ${ABSENCE_WINDOW_MS}ms the absence was watched for `
      + 'to call that absence isolation',
    ).to.be.lessThan(ABSENCE_WINDOW_MS);
  });
});
