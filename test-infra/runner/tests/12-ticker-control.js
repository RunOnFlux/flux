import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import * as daemon from '../framework/daemon-control.js';

describe('Ticker and block control', function () {
  before(async function () {
    await daemon.stopTicker();
    await daemon.resetAll();
  });

  after(async function () {
    await daemon.resetAll();
  });

  it('should start with ticker paused', async function () {
    const state = await daemon.getState();
    expect(state.tickerRunning).to.equal(false);
  });

  it('should advance height when ticker started', async function () {
    const before = await daemon.getState();
    await daemon.startTicker();
    await new Promise((r) => setTimeout(r, 6000));
    const after = await daemon.getState();
    expect(after.currentHeight).to.be.greaterThan(before.currentHeight);
    await daemon.stopTicker();
  });

  it('should stop advancing when ticker stopped', async function () {
    await daemon.stopTicker();
    const before = await daemon.getState();
    await new Promise((r) => setTimeout(r, 6000));
    const after = await daemon.getState();
    expect(after.currentHeight).to.equal(before.currentHeight);
  });

  it('should advance exactly one block per manual advance', async function () {
    const before = await daemon.getState();
    await daemon.advanceBlock();
    const after = await daemon.getState();
    expect(after.currentHeight).to.equal(before.currentHeight + 1);
  });

  it('should include queued app tx in next block', async function () {
    const fakeHash = 'a'.repeat(64);
    await daemon.queueAppTx(fakeHash);
    const stateBefore = await daemon.getState();
    expect(stateBefore.pendingAppTxQueue).to.equal(1);
    await daemon.advanceBlock();
    const stateAfter = await daemon.getState();
    expect(stateAfter.pendingAppTxQueue).to.equal(0);
    expect(stateAfter.pendingBlocks).to.be.greaterThan(stateBefore.pendingBlocks);
  });

  it('should set height directly', async function () {
    await daemon.setHeight(5000000);
    const state = await daemon.getState();
    expect(state.currentHeight).to.equal(5000000);
  });

  it('should reset height and overrides on full reset', async function () {
    await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
    await daemon.enableRpcFailure('198.18.2.0');
    await daemon.removeFromNodeList('198.18.3.0');

    await daemon.resetAll();
    const state = await daemon.getState();
    expect(state.statusOverrides).to.equal(0);
    expect(state.rpcFailures).to.equal(0);
    expect(state.nodeCount).to.equal(16);
    expect(state.pendingBlocks).to.equal(0);
  });
});
