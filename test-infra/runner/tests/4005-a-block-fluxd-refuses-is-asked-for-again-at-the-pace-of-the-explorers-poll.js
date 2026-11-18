/*
 * A block fluxd refuses is asked for again no faster than the explorer polls for a
 * new block, however long fluxd goes on refusing it, and once fluxd gives it the
 * explorer processes it and reaches the tip.
 *
 * fluxd answers every call but getblock for the node under test, so the node keeps
 * reading fluxd as synced and its sync wait never paces the retry. The window is the
 * time between two of the node's reads of fluxd's height (daemonInfoIntervalMs):
 * paced by explorerPollIntervalMs, the explorer asks for the block at most
 * window / poll + 1 times in it.
 *
 * A block above fluxd's chain is answered out of range (-8), and the explorer waits
 * for it at the poll without recovering. The fixture holds the explorer's request
 * for the next block, takes fluxd's chain back to the tip, then lets fluxd answer;
 * the recovery count (explorer:recovery) must not move.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  stopTicker, advanceBlock, getState, setHeight, failRpc, clearRpcFailures, holdRpc, releaseRpc,
  getJournal, clearJournal,
} from '../framework/daemon-control.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 3;
// The middle of the ring: every backward arc wraps onto index 0.
const NODE = 1;
const { daemonInfoIntervalMs, explorerPollIntervalMs } = loadSharedConfig().fluxapps;

describe('a block fluxd refuses is asked for again at the pace of the explorer\'s poll', function () {
  let env;
  let client;
  let ip;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();
    client = env.clients[NODE];
    ip = client.ip;
  });

  afterTeardown(async function () {
    await clearRpcFailures(ip).catch(() => {});
    await releaseRpc(ip).catch(() => {});
    await env?.teardown();
  });

  async function tipProcessed(afterId) {
    const { currentHeight } = await getState();
    await client.waitForEvent('block:processed', (d) => d.height === currentHeight, 120000, { afterId });
    return currentHeight;
  }

  const nextDaemonPoll = (afterId) => client.waitForEvent('daemon:polled', () => true, daemonInfoIntervalMs * 4, { afterId });

  it('asks for the refused block once a poll at most, and processes it once fluxd gives it', async function () {
    this.timeout(240000);
    let mark = client.getLastEventId();
    await advanceBlock();
    await tipProcessed(mark);

    await failRpc(ip, 'getblock', { times: 1000000 });
    mark = client.getLastEventId();
    await advanceBlock();
    const { currentHeight: refused } = await getState();
    // The node has read the new height: from its next poll the explorer asks for
    // the block fluxd refuses.
    const learned = await client.waitForEvent('daemon:polled', (d) => d.height === refused, daemonInfoIntervalMs * 4, { afterId: mark });
    const opened = await nextDaemonPoll(learned.id);
    await clearJournal();
    const openedAt = Date.now();
    await nextDaemonPoll(opened.id);
    const { total: asked } = await getJournal({ method: 'getblock', sourceIp: ip });

    const windowMs = Date.now() - openedAt;
    const ceiling = Math.floor(windowMs / explorerPollIntervalMs) + 1;
    expect(asked, 'the explorer never asked for the refused block').to.be.at.least(1);
    expect(asked, `getblock asked ${asked} times in ${windowMs}ms against a poll of ${explorerPollIntervalMs}ms`).to.be.at.most(ceiling);

    mark = client.getLastEventId();
    await clearRpcFailures(ip);
    expect(await tipProcessed(mark)).to.equal(refused);
  });

  it('waits for a block above fluxd\'s chain without recovering, and processes it once fluxd holds it', async function () {
    this.timeout(240000);
    let mark = client.getLastEventId();
    await advanceBlock();
    const tip = await tipProcessed(mark);

    // The explorer asks for the next block, and fluxd's chain is back at the tip
    // by the time it answers: out of range.
    await holdRpc(ip, 'getblock');
    await clearJournal();
    mark = client.getLastEventId();
    await advanceBlock();
    await waitFor(async () => (await getJournal({ method: 'getblock', sourceIp: ip })).total >= 1, {
      timeout: daemonInfoIntervalMs * 4, interval: 200, label: `the explorer asking for block ${tip + 1}`,
    });
    const lowered = client.getLastEventId();
    await setHeight(tip);
    const recoveries = (await client.getTestCounters())['explorer:recovery'] ?? 0;
    await releaseRpc(ip);

    // The node reads fluxd's height as the tip again: from here the poller asks
    // for nothing above it.
    await client.waitForEvent('daemon:polled', (d) => d.height === tip, daemonInfoIntervalMs * 4, { afterId: lowered });
    await nextDaemonPoll(client.getLastEventId());
    expect((await client.getTestCounters())['explorer:recovery'] ?? 0, 'recoveries from a block fluxd does not hold').to.equal(recoveries);
    await assertNoEvent(client, 'block:processed', (d) => d.height > tip, 0, { afterId: mark });

    mark = client.getLastEventId();
    await advanceBlock();
    expect(await tipProcessed(mark)).to.equal(tip + 1);
  });
});
