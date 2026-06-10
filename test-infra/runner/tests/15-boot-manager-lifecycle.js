import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForBootSettledAndLogged,
} from '../framework/wait.js';
import {
  clearAllNodeStatus,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

// Assertion conventions in this suite:
// - Boot-context FACTS (firstBoot / machineRebooted / cleanShutdown) are
//   asserted on the orchestrator:started event payload — the contract-grade
//   observable — never via log substrings.
// - Settle TIMING is bounded once per block by waitForBootSettledAndLogged in
//   before(), which also anchors the log pipeline (FIFO: once the settle line
//   has arrived, every earlier line has too). Tests are order-independent.
// - LOG asserts are reserved for branch decisions that have no event (which
//   removal/wait path the boot took) and run instantly behind the anchor,
//   where they are race-free — including absence asserts.

// Suite 1: FluxOS-only restart (bootContext='running')
//
// The FluxOS process restarted but the machine did NOT reboot. There is no skip/fast-path:
// reconcileAppsOnBoot runs on every boot (71588a001 removed the machineRebooted gate so a
// container that exited while FluxOS was down still gets restarted), so the boot path here
// is identical to a machine reboot and settles via the same daemon->confirm->db->reconcile
// sequence (hence the same ~50s settle window as the 'rebooted' suite below). This suite
// therefore only asserts what is UNIQUE to a FluxOS-only restart: the boot context is
// detected as machineRebooted=false and, with near-zero downtime, locations are not expired
// (apps are not removed) — the cleanShutdown=false branch that suite 19 doesn't cover.
// Exited-container recovery / running-container-not-bounced is covered by suites 23 and 40.

describe('Boot manager: FluxOS-only restart', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, bootContext: 'running' });
    await waitForDaemonReady(env.clients[0]);
    await waitForBootSettledAndLogged(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('detects machineRebooted=false', async function () {
    this.timeout(10000);
    const event = await env.clients[0].waitForEvent('orchestrator:started', () => true, 5000);
    expect(event.data.bootContext.machineRebooted).to.equal(false);
  });

  it('does not expire locations (near-zero downtime)', function () {
    expect(env.nodeHasLog(0, 'Locations expired')).to.equal(false);
  });
});

// Suite 2: Machine reboot with clean shutdown (bootContext='rebooted')

describe('Boot manager: machine reboot with clean shutdown', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, bootContext: 'rebooted' });
    await waitForDaemonReady(env.clients[0]);
    await waitForBootSettledAndLogged(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect machineRebooted=true with cleanShutdown=true', async function () {
    this.timeout(10000);
    const event = await env.clients[0].waitForEvent('orchestrator:started', () => true, 5000);
    expect(event.data.bootContext.machineRebooted).to.equal(true);
    expect(event.data.bootContext.cleanShutdown).to.equal(true);
    expect(event.data.bootContext.firstBoot).to.equal(false);
  });

  it('should not report locations expired (downtime within SIGTERM window)', function () {
    expect(env.nodeHasLog(0, 'Locations expired')).to.equal(false);
  });
});

// Suite 3: First boot (no heartbeat)

describe('Boot manager: first boot', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, bootContext: 'firstBoot' });
    await waitForDaemonReady(env.clients[0]);
    await waitForBootSettledAndLogged(env);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect firstBoot=true', async function () {
    this.timeout(10000);
    const event = await env.clients[0].waitForEvent('orchestrator:started', () => true, 5000);
    expect(event.data.bootContext.firstBoot).to.equal(true);
    expect(event.data.bootContext.machineRebooted).to.equal(true);
  });

  it('should take the wait-for-sync branch', function () {
    // branch decision has no event — the log line is the only observable
    expect(env.nodeHasLog(0, 'First boot')).to.equal(true);
  });
});

// Suite 4: Daemon timeout during boot
//
// The daemon RPC fails for this node, so the boot path is: daemon wait times
// out → removeAllApps('Daemon timeout') → settle (the finally block always
// settles). Settle is anchored in before(); the test asserts the branch.

describe('Boot manager: daemon timeout', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, bootContext: 'rebooted', rpcFailures: [subnet.nodeIp(1)] });
    await waitForBootSettledAndLogged(env, 0, { timeout: 60000 });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should remove all apps when daemon times out', function () {
    expect(
      env.nodeHasLog(0, 'Daemon not ready after') || env.nodeHasLog(0, 'daemon_timeout'),
    ).to.equal(true);
  });
});

// Suite 5: Not confirmed at boot

describe('Boot manager: not confirmed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this,
      nodes: 1,
      tickerAutostart: false,
      bootContext: 'rebooted',
      nodeStatusOverrides: { [subnet.nodeIp(1)]: 'EXPIRED' },
    });
    await waitForBootSettledAndLogged(env, 0, { timeout: 60000 });
  });

  after(async function () {
    this.timeout(30000);
    await clearAllNodeStatus();
    await env?.teardown();
  });

  it('should remove all apps when node not confirmed at boot', function () {
    expect(env.nodeHasLog(0, 'Node not confirmed')).to.equal(true);
  });
});

// Suite 6: Stale shutdownReason clearing — sigterm → boot → clear → kill → boot → unclean

describe('Boot manager: shutdownReason sequence', function () {
  describe('clean shutdown (SIGTERM writes shutdownReason)', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(120000);
      env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, bootContext: 'rebooted' });
      await waitForDaemonReady(env.clients[0]);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('should detect cleanShutdown=true on boot after SIGTERM', async function () {
      this.timeout(60000);
      const event = await env.clients[0].waitForEvent('orchestrator:started', () => true, 50000);
      expect(event.data.bootContext.cleanShutdown).to.equal(true);
      expect(event.data.bootContext.machineRebooted).to.equal(true);
    });
  });

  describe('unclean shutdown (no shutdownReason in heartbeat)', function () {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(120000);
      env = await createTestEnv({ hookCtx: this,
        nodes: 1,
        tickerAutostart: false,
        bootContext: { lastAlive: Date.now() - 60000, machineBootId: 'old-boot-id' },
      });
      await waitForDaemonReady(env.clients[0]);
    });

    after(async function () {
      this.timeout(30000);
      await env?.teardown();
    });

    it('should detect cleanShutdown=false when shutdownReason absent', async function () {
      this.timeout(60000);
      const event = await env.clients[0].waitForEvent('orchestrator:started', () => true, 50000);
      expect(event.data.bootContext.cleanShutdown).to.equal(false);
      expect(event.data.bootContext.machineRebooted).to.equal(true);
    });
  });
});
