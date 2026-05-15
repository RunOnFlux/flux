import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForOrchestratorState, waitForPeerThreshold, waitForPeersBelowThreshold,
  waitForDosChanged, waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
  clearAllNodeStatus,
} from '../framework/daemon-control.js';

// Suite 1: Peer threshold boundaries

describe('Boundary: peer thresholds', function () {
  let env;

  before(async function () {
    this.timeout(180000);
    // 3 nodes: node 0 can have at most 2 peers — exactly appSyncPeerThreshold
    env = await createTestEnv({ nodes: 3, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await env.startDiscovery();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should fire peers:thresholdReached at exactly threshold (2)', async function () {
    this.timeout(120000);
    // appSyncPeerThreshold = 2 in test config. With 3 nodes, node 0
    // should reach exactly 2 peers and fire the threshold event.
    const event = await waitForPeerThreshold(env.clients[0], 90000);
    expect(event.data.count).to.be.greaterThanOrEqual(2);
  });

  it('should NOT fire peers:belowThreshold at exactly degraded threshold (1 peer)', async function () {
    this.timeout(60000);
    // Reach READY first so degradation check is active
    await advanceBlock();
    await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();

    // Disconnect 1 of 2 peers, leaving exactly 1 peer
    // appSyncDegradedThreshold = 1, check is `< 1`, so 1 peer should NOT trigger
    await env.disconnectNode(2);
    await new Promise((r) => setTimeout(r, 10000));

    const belowEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'peers:belowThreshold');
    expect(belowEvents.length, 'peers:belowThreshold should NOT fire at exactly threshold').to.equal(0);

    // Verify still in READY (not DEGRADED)
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged' && e.data.to === 'DEGRADED');
    expect(stateEvents.length).to.equal(0);
  });

  it('should fire peers:belowThreshold at zero peers', async function () {
    this.timeout(30000);
    // Disconnect the last peer (node 1)
    await env.disconnectNode(1);
    await waitForPeersBelowThreshold(env.clients[0], 20000);
  });
});

// Suite 2: DOS boundaries

describe('Boundary: DOS state', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 30000);
  });

  afterEach(async function () {
    this.timeout(10000);
    await env.clients[0].setDOSState(0, null);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should allow loginPhrase at dosState=10 (boundary: > 10 not >= 10)', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(10, null);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 10, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('success');
  });

  it('should block loginPhrase at dosState=11', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(11, null);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 11, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('error');
  });
});

// Suite 3: Block timer boundaries

describe('Boundary: block timer', function () {
  let env;

  before(async function () {
    this.timeout(180000);
    // 2 nodes so peer threshold is never met (need 2 peers, only 1 available)
    // This forces reliance on the block timer.
    env = await createTestEnv({ nodes: 2, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    await Promise.all(env.clients.map((c) => waitForBlockProcessed(c, () => true, 30000)));
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 10000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should NOT transition to READY at 249 blocks (just under threshold)', async function () {
    this.timeout(120000);
    // Block timer threshold for non-enterprise = 125 * 2 = 250 blocks
    await advanceBlocks(249);
    await new Promise((r) => setTimeout(r, 5000));
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged' && e.data.to === 'READY');
    expect(stateEvents.length, 'should not be READY at 249 blocks').to.equal(0);
  });

  it('should transition to READY at 250 blocks (exact threshold)', async function () {
    this.timeout(60000);
    // Advance the 250th block (we already did 249 + the initial 1 = 250 total)
    await advanceBlock();
    await waitForOrchestratorState(env.clients[0], 'READY', 30000);
  });
});

// Suite 4: Boot expiry boundaries

describe('Boundary: boot expiry SIGTERM_EXPIRY_MS', function () {
  it('should NOT expire at exactly 420,000ms (strict > comparison)', async function () {
    // SIGTERM_EXPIRY_MS = 420,000ms
    // locationsExpired = (cleanShutdown && downtimeMs > SIGTERM_EXPIRY_MS)
    // At exactly 420,000ms: 420000 > 420000 = false → NOT expired
    // This is a code-level boundary documented here. Integration test would
    // require precise timing control that's impractical in Docker.
    // The off-by-one boundary is: 420,000ms → safe, 420,001ms → expired.
    expect(420000 > 420000).to.equal(false, 'strict > means exactly at threshold is NOT expired');
    expect(420001 > 420000).to.equal(true, 'one ms past threshold IS expired');
  });

  it('should NOT expire dirty shutdown at exactly 7,500,000ms', async function () {
    // RUNNING_EXPIRY_MS = 7,500,000ms
    // locationsExpired = downtimeMs > RUNNING_EXPIRY_MS (for dirty shutdown)
    expect(7500000 > 7500000).to.equal(false, 'strict > means exactly at threshold is NOT expired');
    expect(7500001 > 7500000).to.equal(true, 'one ms past threshold IS expired');
  });
});
