import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getState, startTicker, stopTicker, advanceBlock, setHeight,
  queueAppTx, setNodeStatus, clearNodeStatus, getNodeStatusOverrides,
  enableRpcFailure, disableRpcFailure, removeFromNodeList, restoreToNodeList,
} from '../framework/daemon-control.js';

let env;

describe('Ticker and block control', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 0 });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should report ticker state', async function () {
    const state = await getState();
    expect(state).to.have.property('tickerRunning');
    expect(state).to.have.property('currentHeight');
  });

  it('should start with ticker stopped (default)', async function () {
    const state = await getState();
    expect(state.tickerRunning).to.equal(false);
  });

  it('should advance height when ticker started', async function () {
    const before = await getState();
    await startTicker();
    await new Promise((r) => setTimeout(r, 6000));
    const after = await getState();
    expect(after.currentHeight).to.be.greaterThan(before.currentHeight);
    await stopTicker();
  });

  it('should not advance height when ticker stopped', async function () {
    await stopTicker();
    const before = await getState();
    await new Promise((r) => setTimeout(r, 6000));
    const after = await getState();
    expect(after.currentHeight).to.equal(before.currentHeight);
  });

  it('should advance exactly one block per manual advance', async function () {
    await stopTicker();
    const before = await getState();
    await advanceBlock();
    const after = await getState();
    expect(after.currentHeight).to.equal(before.currentHeight + 1);
  });

  it('should include queued app tx in next block', async function () {
    await stopTicker();
    const fakeHash = 'a'.repeat(64);
    await queueAppTx(fakeHash);
    const stateBefore = await getState();
    expect(stateBefore.pendingAppTxQueue).to.equal(1);
    await advanceBlock();
    const stateAfter = await getState();
    expect(stateAfter.pendingAppTxQueue).to.equal(0);
    expect(stateAfter.pendingBlocks).to.be.greaterThan(stateBefore.pendingBlocks);
  });

  it('should set height directly', async function () {
    await stopTicker();
    const before = await getState();
    const target = before.currentHeight + 10;
    await setHeight(target);
    const state = await getState();
    expect(state.currentHeight).to.equal(target);
  });

  it('should set and clear node status overrides', async function () {
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    const overrides = await getNodeStatusOverrides();
    expect(overrides['198.18.1.0'].status).to.equal('EXPIRED');
    await clearNodeStatus('198.18.1.0');
  });

  it('should set and clear RPC failures', async function () {
    await enableRpcFailure('198.18.2.0');
    let state = await getState();
    expect(state.rpcFailures).to.equal(1);
    await disableRpcFailure('198.18.2.0');
    state = await getState();
    expect(state.rpcFailures).to.equal(0);
  });

  it('should remove and restore nodes in deterministic list', async function () {
    const before = await getState();
    await removeFromNodeList('198.18.3.0');
    let state = await getState();
    expect(state.nodeCount).to.equal(before.nodeCount - 1);
    await restoreToNodeList('198.18.3.0');
    state = await getState();
    expect(state.nodeCount).to.equal(before.nodeCount);
  });
});
