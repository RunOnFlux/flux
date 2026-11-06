/*
 * One give-up-an-app pass runs at a time.
 *
 * The block scanner starts the pass without awaiting it, so a pass can still be running when the
 * next one is due. The node's pass is held at giveUp:beforePass, inside the pass lock, while the
 * chain moves on to the next multiple of the period. The pass due there must be skipped rather
 * than run beside the held one. Released, the held pass finishes and frees the lock, and the pass
 * due after that runs.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { advanceBlock, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 0;
const JOB = 'checkAndRemoveApplicationInstance';
const BEFORE_PASS = 'giveUp:beforePass';

function eventsAfter(client, afterId, name, predicate = () => true) {
  return client.getEventBuffer().filter((e) => e.id > afterId && e.event === name && predicate(e.data));
}

function passesDue(client, afterId) {
  return eventsAfter(client, afterId, 'blockWork:ran', (d) => d.job === JOB).map((e) => e.data.height);
}

function heldPasses(client, afterId) {
  return eventsAfter(client, afterId, 'checkpoint:held', (d) => d.name === BEFORE_PASS);
}

// Advances the chain until the node has started the pass once more after `afterId`, and answers
// the height it was due at.
async function advanceToNextPass(client, afterId, label) {
  await waitFor(async () => {
    if (passesDue(client, afterId).length >= 1) return true;
    await advanceBlock();
    return false;
  }, { timeout: 600000, interval: 1500, label });
  return passesDue(client, afterId)[0];
}

describe('a give-up pass due while one is running is skipped', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let firstDue;
  let secondDue;
  let skipped;
  let heldWhileFirstRan;
  let thirdDue;
  let thirdHeld;

  before(async function () {
    this.timeout(1500000);
    env = await createTestEnv({ hookCtx: this, nodes: 2 });
    await bootAndPeer(env);
    await stopTicker();

    const node = env.clients[NODE];
    await node.holdCheckpoint(BEFORE_PASS);
    const from = node.getLastEventId();
    firstDue = await advanceToNextPass(node, from, 'the node starts a give-up pass');
    await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_PASS, 60000, { afterId: from });

    const afterFirst = node.getLastEventId();
    secondDue = await advanceToNextPass(node, afterFirst, 'the next give-up pass falls due');
    // Skipped, or run beside the held pass and paused at the same checkpoint.
    await waitFor(
      () => eventsAfter(node, afterFirst, 'giveUp:passSkipped').length > 0 || heldPasses(node, afterFirst).length > 0,
      { timeout: 60000, interval: 1000, label: 'the pass due while one runs is skipped or starts' },
    );
    skipped = eventsAfter(node, afterFirst, 'giveUp:passSkipped').map((e) => e.data);
    heldWhileFirstRan = heldPasses(node, from);

    // Released, the held pass finishes. Held again, the next pass due must reach the checkpoint:
    // the lock was freed.
    await node.releaseCheckpoint(BEFORE_PASS);
    await node.holdCheckpoint(BEFORE_PASS);
    const afterRelease = node.getLastEventId();
    thirdDue = await advanceToNextPass(node, afterRelease, 'a give-up pass falls due after the held one finished');
    thirdHeld = (await node.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_PASS, 60000, { afterId: afterRelease })).data;
  });

  after(async function () {
    this.timeout(60000);
    await env?.clients[NODE]?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('the pass due while one was running was skipped, not run beside it', function () {
    expect(secondDue, JSON.stringify({ firstDue, secondDue })).to.be.above(firstDue);
    expect(heldWhileFirstRan, 'passes paused inside the pass at once').to.have.lengthOf(1);
    expect(skipped).to.deep.equal([{ height: secondDue }]);
  });

  it('once the running pass finished, the next pass due ran', function () {
    expect(thirdDue).to.be.above(secondDue);
    expect(thirdHeld.name).to.equal(BEFORE_PASS);
  });
});
