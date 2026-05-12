import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { waitForApi, waitForExplorerSynced, waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { hasLogLine } from '../framework/log-reader.js';

let env;

describe('App spawning', function () {
  const appName = `e2eSpawn${Date.now()}`;

  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({ nodes: 2, tickerAutostart: true });
    await waitForApi(env.clients[0]);
    await waitForExplorerSynced(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('spawner activation', function () {
    it('should log spawner checking for installable apps', async function () {
      this.timeout(120000);
      await waitFor(async () => {
        return hasLogLine(1, 'trySpawningGlobalApplication');
      }, { timeout: 110000, interval: 10000, label: 'spawner log entry' });
      const found = await hasLogLine(1, 'trySpawningGlobalApplication');
      expect(found).to.equal(true);
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
      const found = await hasLogLine(1, 'Running Apps.*broadcasted');
      expect(found).to.equal(true);
    });
  });
});
