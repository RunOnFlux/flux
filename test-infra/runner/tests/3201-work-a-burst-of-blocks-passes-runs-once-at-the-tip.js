/*
 * Work paced by the chain that a node passes while catching up runs once, on the block that
 * reaches the tip.
 *
 * The give-up-an-app pass runs every removeFluxAppsPeriod blocks. One node's explorer is held at
 * explorer:beforeBlock while the chain moves on past a multiple of that period - a control node,
 * processing every block at the tip, runs the pass on it. Released, the held node processes the
 * blocks it missed back to back, behind the tip, and reaches the tip on the last. It must run the
 * pass exactly once, on that block, and on none of the blocks behind it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor, waitForBlockProcessed } from '../framework/wait.js';
import { advanceBlock, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HELD = 0;
const CONTROL = 1;
const JOB = 'checkAndRemoveApplicationInstance';
const BEFORE_BLOCK = 'explorer:beforeBlock';

function runsOf(client, afterId) {
  return client.getEventBuffer()
    .filter((e) => e.id > afterId && e.event === 'blockWork:ran' && e.data.job === JOB)
    .map((e) => e.data.height);
}

describe('work a burst of blocks passes runs once, at the tip', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let controlRuns;
  let passed;
  let tip;
  let heldRuns;
  let heldFrom;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);
    await stopTicker();

    const held = env.clients[HELD];
    const control = env.clients[CONTROL];
    await held.holdCheckpoint(BEFORE_BLOCK);
    const controlFrom = control.getLastEventId();
    await advanceBlock();
    const heldAt = await held.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_BLOCK, 120000);
    heldFrom = heldAt.id;

    // On until the control node has run the pass twice: the second is a multiple of the period
    // the held node has not processed at the tip.
    await waitFor(async () => {
      if (runsOf(control, controlFrom).length >= 2) return true;
      await advanceBlock();
      return false;
    }, { timeout: 600000, interval: 1500, label: 'the control node runs the pass twice' });
    controlRuns = runsOf(control, controlFrom);
    passed = controlRuns[1];
    const lastBefore = control.getLastEventId();
    await advanceBlock();
    await advanceBlock();
    tip = (await waitForBlockProcessed(control, (d) => d.height >= passed + 2, 60000, { afterId: lastBefore })).data.height;

    await held.releaseCheckpoint(BEFORE_BLOCK);
    // The node publishes the work it ran at a tip block before it publishes the block processed.
    await waitForBlockProcessed(held, (d) => d.height >= tip, 300000, { afterId: heldFrom });
    heldRuns = runsOf(held, heldFrom);
  });

  after(async function () {
    this.timeout(60000);
    await env?.clients[HELD]?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('a node at the tip ran the pass on a multiple the held node never processed at the tip', function () {
    expect(controlRuns, JSON.stringify(controlRuns)).to.have.length.of.at.least(2);
    expect(passed).to.be.a('number');
  });

  it('the held node ran the pass exactly once after catching up, past the multiple it missed', function () {
    expect(heldRuns, JSON.stringify({ heldRuns, passed, tip })).to.have.lengthOf(1);
    expect(heldRuns[0]).to.be.at.least(passed);
  });
});
