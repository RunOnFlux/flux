import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { startTicker } from '../framework/daemon-control.js';
import { waitForApi, waitForBoot, waitForExplorerSynced, waitFor, waitForPeers, waitForIncomingPeers } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';

let env;

describe('App spawning', function () {
  const appName = `e2eSpawn${Date.now()}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ nodes: 8, tickerAutostart: false });
    for (const client of env.clients) {
      await waitForApi(client);
    }
    await waitForBoot(env, 0);
    await waitForExplorerSynced(env.clients[0]);
    await waitForPeers(env.clients[0], 4, 120000);
    await waitForIncomingPeers(env.clients[0], 2, 120000);
    await startTicker();
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('spawner activation', function () {
    it('should log spawner checking for installable apps', async function () {
      this.timeout(120000);
      await waitFor(async () => {
        return env.nodeHasLog(0, 'trySpawningGlobalApplication');
      }, { timeout: 110000, interval: 10000, label: 'spawner log entry' });
      expect(env.nodeHasLog(0, 'trySpawningGlobalApplication')).to.equal(true);
    });
  });

  describe('app spec after registration', function () {
    before(async function () {
      this.timeout(120000);
      const spec = buildAppSpec({ name: appName, instances: 3 });
      const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
      expect(result.status).to.equal('success');
      const db = dbClient(1);
      await waitFor(async () => {
        const count = await db.appSpecCount();
        return count > 0;
      }, { timeout: 50000, interval: 5000, label: 'app spec in DB' });
    });

    it('should have app spec in zelappsinformation', async function () {
      const db = dbClient(1);
      const count = await db.appSpecCount();
      expect(count).to.be.greaterThan(0);
    });
  });

  describe('running broadcast', function () {
    it('should broadcast running apps message', async function () {
      expect(env.nodeHasLog(0, 'Running Apps.*broadcasted')).to.equal(true);
    });
  });
});
