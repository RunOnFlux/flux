import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForMessageCapabilityChanged,
  waitForDaemonUnreachable, waitForDaemonRecovered, waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, setNodeStatus, clearAllNodeStatus, clearNodeStatus,
  enableRpcFailure, disableRpcFailure, disableAllRpcFailure,
  removeFromNodeList, restoreToNodeList, resetNodeList,
} from '../framework/daemon-control.js';

describe('Confirmation service: CONFIRMED detection', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect confirmed status via poll', async function () {
    this.timeout(30000);
    const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 20000);
    expect(event.data.confirmed).to.equal(true);
  });
});

describe('Confirmation service: node list removal → message capability lost', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 3, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
  });

  after(async function () {
    this.timeout(30000);
    await resetNodeList();
    await env?.teardown();
  });

  it('should lose message capability when removed from deterministic list', async function () {
    this.timeout(30000);
    await removeFromNodeList(env.clients[0].ip);
    await advanceBlock();
    const event = await waitForMessageCapabilityChanged(env.clients[0], false, 20000);
    expect(event.data.capable).to.equal(false);
  });
});

describe('Confirmation service: RPC failure windows', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 30000);
  });

  afterEach(async function () {
    this.timeout(10000);
    await disableAllRpcFailure();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should preserve confirmation within stale window (< 120s)', async function () {
    this.timeout(30000);
    await enableRpcFailure(env.clients[0].ip);
    // Wait less than confirmationDaemonStaleMs (120s in test config)
    await new Promise((r) => setTimeout(r, 10000));
    // Confirmation should still be preserved (previous value kept)
    const events = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'confirmation:changed' && e.data.confirmed === false);
    expect(events.length, 'confirmation should be preserved within stale window').to.equal(0);
  });

  it('should detect daemon stale beyond stale window (> 120s)', async function () {
    this.timeout(180000);
    await enableRpcFailure(env.clients[0].ip);
    // Wait past confirmationDaemonStaleMs (120s in test config)
    await waitFor(
      () => env.nodeHasLog(0, 'Daemon unreachable for') && env.nodeHasLog(0, 'stale'),
      { timeout: 150000, interval: 5000, label: 'daemon stale detection' },
    );
  });

  it('should lose confirmation beyond expired window (> 300s)', async function () {
    this.timeout(360000);
    await enableRpcFailure(env.clients[0].ip);
    // Wait past confirmationDaemonExpiredMs (300s in test config)
    const event = await waitForNodeStatus(
      env.clients[0],
      (d) => d.confirmed === false,
      330000,
    );
    expect(event.data.confirmed).to.equal(false);
  });

  it('should recover confirmation when RPC becomes available', async function () {
    this.timeout(60000);
    // After the previous test, RPC was failing and confirmation was lost.
    // Disabling RPC failure should allow the next poll to restore confirmation.
    await disableAllRpcFailure();
    const event = await waitForNodeStatus(
      env.clients[0],
      (d) => d.confirmed === true,
      30000,
    );
    expect(event.data.confirmed).to.equal(true);
  });
});
