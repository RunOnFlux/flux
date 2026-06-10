import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getState, startTicker, stopTicker, advanceBlock, setHeight,
  queueAppTx, setNodeStatus, clearNodeStatus, getNodeStatusOverrides,
  enableRpcFailure, disableRpcFailure, setNodeList, removeFromNodeList, restoreToNodeList,
  resetAll,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

let env;

describe('Ticker and block control', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 0 });
  });

  afterEach(async function () {
    await stopTicker();
    await resetAll();
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
    await setNodeStatus(subnet.nodeIp(1), 'EXPIRED');
    const overrides = await getNodeStatusOverrides();
    expect(overrides[subnet.nodeIp(1)].status).to.equal('EXPIRED');
    await clearNodeStatus(subnet.nodeIp(1));
  });

  it('should set and clear RPC failures', async function () {
    await enableRpcFailure(subnet.nodeIp(2));
    let state = await getState();
    expect(state.rpcFailures).to.equal(1);
    await disableRpcFailure(subnet.nodeIp(2));
    state = await getState();
    expect(state.rpcFailures).to.equal(0);
  });

  it('should remove and restore nodes in deterministic list', async function () {
    // nodes:0 leaves the stub's node list empty, so seed a known list to exercise
    // remove/restore against (the feature under test).
    await setNodeList([
      { ip: subnet.nodeIp(1) },
      { ip: subnet.nodeIp(2) },
      { ip: subnet.nodeIp(3) },
    ]);
    const before = await getState();
    await removeFromNodeList(subnet.nodeIp(3));
    let state = await getState();
    expect(state.nodeCount).to.equal(before.nodeCount - 1);
    await restoreToNodeList(subnet.nodeIp(3));
    state = await getState();
    expect(state.nodeCount).to.equal(before.nodeCount);
  });
});
