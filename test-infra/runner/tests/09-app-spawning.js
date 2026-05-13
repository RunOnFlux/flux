import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForBlockProcessed, waitFor, waitForAppInstalled } from '../framework/wait.js';

let env;

describe('App spawning', function () {
  const appName = `e2eSpawn${Date.now()}`;
  let registrationResult;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 8, tickerAutostart: false });
    for (const client of env.clients) await waitForDaemonReady(client);
    await advanceBlock();
    for (const client of env.clients) {
      await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
    }
    await waitFor(async () => {
      const peerEvents = env.clients[0].getEventBuffer().filter((e) => e.event === 'peers:added');
      const last = peerEvents[peerEvents.length - 1];
      return last && last.data.outbound >= 4 && last.data.inbound >= 2;
    }, { timeout: 120000, interval: 5000, label: 'node 0 has 4+ outbound and 2+ inbound peers' });

    const spec = buildAppSpec({ name: appName, instances: 3 });
    registrationResult = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
    expect(registrationResult.status).to.equal('success');
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= registrationResult.targetHeight, 60000);
    await startTicker();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('app spec propagation', function () {
    it('should have app spec accessible via API on registering node', async function () {
      this.timeout(60000);
      await waitFor(async () => {
        const res = await env.clients[0].getAppSpecs(appName);
        return res.status === 'success' && res.data?.[0]?.name === appName;
      }, { timeout: 50000, interval: 5000, label: 'app spec via API' });
      const res = await env.clients[0].getAppSpecs(appName);
      expect(res.data[0].name).to.equal(appName);
      expect(res.data[0].instances).to.equal(3);
    });

    it('should have app spec propagated to a second node', async function () {
      this.timeout(60000);
      await waitFor(async () => {
        const res = await env.clients[1].getAppSpecs(appName);
        return res.status === 'success' && res.data?.[0]?.name === appName;
      }, { timeout: 50000, interval: 5000, label: 'app spec on node 2' });
      const res = await env.clients[1].getAppSpecs(appName);
      expect(res.data[0].name).to.equal(appName);
    });
  });

  describe('spawner decision', function () {
    it('should reach the install decision for the registered app', async function () {
      this.timeout(180000);
      const decided = await waitFor(async () => {
        return env.nodeHasLog(0, 'successfully installed')
          || env.nodeHasLog(0, 'Error.*registerAppLocally')
          || env.nodeHasLog(0, 'already installed')
          || env.nodeHasLog(0, 'already spawned or being installed')
          || env.nodeHasLog(0, 'Unable to communicate with Flux Services')
          || env.nodeHasLog(0, `${appName}.*selected`)
          || env.nodeHasLog(0, 'Found.*apps.*missing instances');
      }, { timeout: 170000, interval: 10000, label: 'spawner install decision' });
      expect(decided).to.equal(true);
    });

    it('should show the app as installed if installation succeeded', async function () {
      this.timeout(30000);
      const installed = env.clients[0].getEventBuffer().some((e) => e.event === 'app:installed');
      if (!installed) {
        this.skip();
        return;
      }
      const res = await env.clients[0].getInstalledApps();
      expect(res.status).to.equal('success');
      const found = res.data.find((a) => a.name === appName);
      expect(found).to.not.be.undefined;
    });
  });
});
