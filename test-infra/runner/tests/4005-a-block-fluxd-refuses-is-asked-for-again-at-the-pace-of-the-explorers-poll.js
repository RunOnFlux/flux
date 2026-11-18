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
 * The daemon stub's refusal is a generic RPC error. fluxd's out-of-range answer
 * (-8), which the explorer waits on instead of recovering from, is covered by the
 * unit suite: the stub serves a block at any height.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  stopTicker, advanceBlock, getState, failRpc, clearRpcFailures, getJournal, clearJournal,
} from '../framework/daemon-control.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
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
});
