import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForApi, waitForExplorerSynced } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import * as daemon from '../framework/daemon-control.js';

let env;

describe('Boot: explorer sync', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 2, tickerAutostart: true });
    await waitForApi(env.clients[0]);
    await waitForExplorerSynced(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('fresh database (seeded height)', function () {
    it('should have explorer height above seeded value', async function () {
      const db = dbClient(1);
      const height = await db.explorerHeight();
      expect(height).to.be.greaterThanOrEqual(2100000);
    });

    it('should have explorer tracking daemon height', async function () {
      const state = await daemon.getState();
      const db = dbClient(1);
      const explorerHeight = await db.explorerHeight();
      expect(state.currentHeight - explorerHeight).to.be.lessThanOrEqual(5);
    });

    it('should have zelappshashes collection accessible', async function () {
      const db = dbClient(1);
      const hashes = await db.hashCounts();
      expect(hashes.total).to.be.a('number');
    });
  });

  describe('cross-node explorer consistency', function () {
    before(async function () {
      this.timeout(120000);
      await waitForApi(env.clients[1]);
      await waitForExplorerSynced(env.clients[1]);
    });

    it('should have similar explorer height on node 1 and node 2', async function () {
      const db1 = dbClient(1);
      const db2 = dbClient(2);
      const h1 = await db1.explorerHeight();
      const h2 = await db2.explorerHeight();
      expect(Math.abs(h1 - h2)).to.be.lessThanOrEqual(10);
    });

    it('should have same hash count on node 1 and node 2', async function () {
      const db1 = dbClient(1);
      const db2 = dbClient(2);
      const c1 = await db1.hashCounts();
      const c2 = await db2.hashCounts();
      expect(c1.total).to.equal(c2.total);
    });
  });
});
