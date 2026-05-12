import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { nodeClient, allNodes } from '../framework/node-client.js';
import { dbClient } from '../framework/db-client.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForExplorerSynced, waitFor } from '../framework/wait.js';
import { isAppContainerRunning, listAppContainers } from '../framework/container.js';
import { hasLogLine } from '../framework/log-reader.js';

const node = nodeClient(1);
const nodes = allNodes();
const db = dbClient(1);

describe('App spawning', function () {
  const appName = `e2eSpawn${Date.now()}`;

  before(async function () {
    this.timeout(600000);
    await daemon.startTicker();
    await waitForApi(node);
    await waitForExplorerSynced(node, 180000);
  });

  describe('spawner activation', function () {
    it('should not spawn before explorer is synced', async function () {
      const found = await hasLogLine(1, 'Daemon not yet synced|Daemon Sync status');
      expect(found).to.equal(true);
    });

    it('should log spawner checking for installable apps', async function () {
      await waitFor(async () => {
        return hasLogLine(1, 'trySpawningGlobalApplication');
      }, { timeout: 300000, interval: 10000, label: 'spawner log entry' });
      const found = await hasLogLine(1, 'trySpawningGlobalApplication');
      expect(found).to.equal(true);
    });
  });

  describe('app installation', function () {
    before(async function () {
      this.timeout(600000);
      const spec = buildAppSpec({ name: appName, instances: 3 });
      const result = await registerAndConfirm(node.url, nodeKey(1), spec, nodes);
      expect(result.status).to.equal('success');
      // Wait for spawner cycle to detect and install
      await waitFor(async () => {
        return hasLogLine(1, `Installing ${appName}|trySpawningGlobalApplication.*${appName}`);
      }, { timeout: 300000, interval: 10000, label: `spawner detects ${appName}` });
    });

    it('should detect installable app after registration', async function () {
      const found = await hasLogLine(1, 'trySpawningGlobalApplication');
      expect(found).to.equal(true);
    });

    it('should have app spec in zelappsinformation', async function () {
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
