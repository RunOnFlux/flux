import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  waitForDaemonReady, waitForBootSettled, waitFor,
} from '../framework/wait.js';
import {
  clearAllNodeStatus,
} from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Suite 1: FluxOS-only restart (bootContext='running')

describe('Boot manager: FluxOS-only restart', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false, bootContext: 'running' });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect machineRebooted=false', async function () {
    this.timeout(30000);
    await waitForBootSettled(env.clients[0], 20000);
    expect(env.nodeHasLog(0, 'machineRebooted=false')).to.equal(true);
  });

  it('should skip container management', async function () {
    expect(env.nodeHasLog(0, 'FluxOS-only restart')).to.equal(true);
  });

  it('should settle boot state immediately', async function () {
    const settledEvents = env.clients[0].getEventBuffer()
      .filter((e) => e.event === 'boot:settled');
    expect(settledEvents.length).to.be.greaterThan(0);
  });
});

// Suite 2: Machine reboot with clean shutdown (bootContext='rebooted')

describe('Boot manager: machine reboot with clean shutdown', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false, bootContext: 'rebooted' });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect machineRebooted=true with cleanShutdown=true', async function () {
    this.timeout(60000);
    await waitForBootSettled(env.clients[0], 50000);
    expect(env.nodeHasLog(0, 'machineRebooted=true')).to.equal(true);
    expect(env.nodeHasLog(0, 'cleanShutdown=true')).to.equal(true);
    expect(env.nodeHasLog(0, 'firstBoot=false')).to.equal(true);
  });

  it('should not report locations expired (downtime within SIGTERM window)', async function () {
    expect(env.nodeHasLog(0, 'Locations expired')).to.equal(false);
  });
});

// Suite 3: First boot (no heartbeat)

describe('Boot manager: first boot', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false, bootContext: 'firstBoot' });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect firstBoot=true', async function () {
    this.timeout(60000);
    await waitForBootSettled(env.clients[0], 50000);
    expect(env.nodeHasLog(0, 'firstBoot=true')).to.equal(true);
    expect(env.nodeHasLog(0, 'machineRebooted=true')).to.equal(true);
  });

  it('should wait for sync then settle', async function () {
    expect(env.nodeHasLog(0, 'First boot')).to.equal(true);
    expect(env.nodeHasLog(0, 'Boot container state settled')).to.equal(true);
  });
});

// Suite 4: Daemon timeout during boot

describe('Boot manager: daemon timeout', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false, bootContext: 'rebooted', rpcFailures: ['198.18.1.0'] });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should remove all apps when daemon times out', async function () {
    this.timeout(60000);
    await waitFor(
      () => env.nodeHasLog(0, 'Daemon not ready after') || env.nodeHasLog(0, 'daemon_timeout'),
      { timeout: 50000, interval: 2000, label: 'daemon timeout log' },
    );
    expect(env.nodeHasLog(0, 'Boot container state settled')).to.equal(true);
  });
});

// Suite 5: Not confirmed at boot

describe('Boot manager: not confirmed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({
      nodes: 1,
      tickerAutostart: false,
      bootContext: 'rebooted',
      nodeStatusOverrides: { '198.18.1.0': 'EXPIRED' },
    });
  });

  after(async function () {
    this.timeout(30000);
    await clearAllNodeStatus();
    await env?.teardown();
  });

  it('should remove all apps when node not confirmed at boot', async function () {
    this.timeout(60000);
    await waitFor(
      () => env.nodeHasLog(0, 'Node not confirmed'),
      { timeout: 50000, interval: 2000, label: 'not confirmed log' },
    );
    expect(env.nodeHasLog(0, 'Boot container state settled')).to.equal(true);
  });
});
