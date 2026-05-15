import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForExplorerReady, waitForOrchestratorStarted, waitForOrchestratorState,
  waitForPeerThreshold, waitForPeersBelowThreshold, waitForBootSettled,
  waitForDosChanged, waitFor,
} from '../framework/wait.js';
import {
  advanceBlock, advanceBlocks, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';

// Suite 1: Peer threshold boundaries

describe('Boundary: peer thresholds', function () {
  let env;

  before(async function () {
    this.timeout(180000);
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
    const event = await waitForPeerThreshold(env.clients[0], 90000);
    expect(event.data.count).to.be.greaterThanOrEqual(2);
  });

  it('should NOT fire peers:belowThreshold at exactly degraded threshold (1 peer)', async function () {
    this.timeout(60000);
    await waitForExplorerReady(env.clients[0]);
    await waitForOrchestratorStarted(env.clients[0]);
    await advanceBlock();
    await waitForBlockProcessed(env.clients[0], () => true, 20000);
    await startTicker();
    await waitForOrchestratorState(env.clients[0], 'READY', 120000);
    await stopTicker();

    await env.disconnectNode(2);
    // Wait for ping detection
    await new Promise((r) => setTimeout(r, 5000));

    const belowEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'peers:belowThreshold');
    expect(belowEvents.length, 'peers:belowThreshold should NOT fire at exactly threshold').to.equal(0);
  });

  it('should fire peers:belowThreshold at zero peers', async function () {
    this.timeout(30000);
    await env.disconnectNode(1);
    await waitForPeersBelowThreshold(env.clients[0], 20000);
  });
});

// Suite 2: DOS boundaries

describe('Boundary: DOS state', function () {
  let env;
  let fluxTeamAuth;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 30000);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
  });

  afterEach(async function () {
    this.timeout(10000);
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should allow loginPhrase at dosState=10 (boundary: > 10 not >= 10)', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(10, null, fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 10, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('success');
  });

  it('should block loginPhrase at dosState=11', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(11, null, fluxTeamAuth.zelidauth);
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
    env = await createTestEnv({ nodes: 2, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await waitForExplorerReady(env.clients[0]);
    await waitForOrchestratorStarted(env.clients[0]);
    await advanceBlock();
    await waitForOrchestratorState(env.clients[0], 'SYNCING', 20000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should NOT transition to READY at 249 blocks (just under threshold)', async function () {
    this.timeout(120000);
    await advanceBlocks(249);
    // Wait for blocks to be processed
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= 2100250, 30000);
    const stateEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'orchestrator:stateChanged' && e.data.to === 'READY');
    expect(stateEvents.length, 'should not be READY at 249 blocks').to.equal(0);
  });

  it('should transition to READY at 250 blocks (exact threshold)', async function () {
    this.timeout(30000);
    await advanceBlock();
    await waitForOrchestratorState(env.clients[0], 'READY', 20000);
  });
});

// Suite 4: Boot expiry boundaries

describe('Boundary: clean shutdown within SIGTERM_EXPIRY', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    // 300s ago with sigterm — within 420s SIGTERM_EXPIRY_MS
    env = await createTestEnv({
      nodes: 1,
      tickerAutostart: false,
      bootContext: { lastAlive: Date.now() - 300000, machineBootId: 'old-boot-id', shutdownReason: 'sigterm' },
    });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should NOT remove apps when downtime within SIGTERM window', async function () {
    this.timeout(60000);
    await waitForBootSettled(env.clients[0], 50000);
    expect(env.nodeHasLog(0, 'Locations expired')).to.equal(false);
  });
});

describe('Boundary: clean shutdown beyond SIGTERM_EXPIRY', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    // 500s ago with sigterm — exceeds 420s SIGTERM_EXPIRY_MS
    env = await createTestEnv({
      nodes: 1,
      tickerAutostart: false,
      bootContext: { lastAlive: Date.now() - 500000, machineBootId: 'old-boot-id', shutdownReason: 'sigterm' },
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should remove apps when downtime exceeds SIGTERM window', async function () {
    this.timeout(30000);
    await waitForBootSettled(env.clients[0], 20000);
    expect(env.nodeHasLog(0, 'Locations expired')).to.equal(true);
  });
});
