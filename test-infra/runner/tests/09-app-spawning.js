import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForBlockProcessed, waitFor, waitForAppInstalled, waitForAppSpecStored, waitForNodeStatus } from '../framework/wait.js';

let env;

describe('App spawning', function () {
  const appName = `e2eSpawn${Date.now()}`;
  let registrationResult;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 10, tickerAutostart: false });
    for (const client of env.clients) await waitForDaemonReady(client);
    await Promise.all(env.clients.map((c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000)));
    await advanceBlock();
    for (const client of env.clients) {
      await waitForBlockProcessed(client, (d) => d.height > 2100000, 50000);
    }
    await env.startDiscovery();
    await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
    await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);

    await startTicker();

    const spec = buildAppSpec({ name: appName, instances: 3 });
    registrationResult = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
    expect(registrationResult.status).to.equal('success');
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= registrationResult.targetHeight, 60000);
    await waitForAppSpecStored(env.clients[0], appName);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('app spec propagation', function () {
    it('should have app spec accessible via API on registering node', async function () {
      const res = await env.clients[0].getAppSpecs(appName);
      expect(res.status).to.equal('success');
      expect(res.data.name).to.equal(appName);
      expect(res.data.instances).to.equal(3);
    });

    it('should have app spec propagated to a second node', async function () {
      await waitForAppSpecStored(env.clients[1], appName);
      const res = await env.clients[1].getAppSpecs(appName);
      expect(res.status).to.equal('success');
      expect(res.data.name).to.equal(appName);
    });
  });

  describe('spawner decision', function () {
    it('should reach the install decision on at least one node', async function () {
      this.timeout(180000);
      const decided = await waitFor(async () => {
        for (let i = 0; i < env.clients.length; i++) {
          if (env.nodeHasLog(i, `${appName}.*selected`)
            || env.nodeHasLog(i, 'Found.*apps.*missing instances')) return true;
        }
        return false;
      }, { timeout: 170000, interval: 10000, label: 'spawner install decision' });
      expect(decided).to.equal(true);
    });

    it('should install the registered app on at least one node', async function () {
      this.timeout(180000);
      try {
        await Promise.any(env.clients.map((c) => waitForAppInstalled(c, appName, 170000)));
      } catch (err) {
        for (let i = 0; i < env.clients.length; i++) {
          const lines = env.nodeLogLines(i).filter((l) =>
            /spawn|install|selected|missing|image|compliance|docker|pull|error|e2eSpawn/i.test(l));
          if (lines.length) {
            console.log(`=== Spawner logs from node ${i} ===`);
            lines.forEach((l) => console.log(l));
          }
        }
        throw err;
      }
      let installedOn = null;
      for (const client of env.clients) {
        const res = await client.getInstalledApps();
        if (res.status === 'success') {
          const found = res.data.find((a) => a.name === appName);
          if (found) { installedOn = client.ip; break; }
        }
      }
      expect(installedOn, 'app not installed on any node').to.not.be.null;
    });
  });
});
