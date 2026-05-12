import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { dbClient } from '../framework/db-client.js';
import { waitForApi, waitForExplorerSynced } from '../framework/wait.js';
import * as daemon from '../framework/daemon-control.js';

const node = nodeClient(1);
const node2 = nodeClient(2);
const db = dbClient(1);
const db2 = dbClient(2);

describe('Boot: explorer sync', function () {
  before(async function () {
    await waitForApi(node);
    await daemon.startTicker();
    await waitForExplorerSynced(node, 180000);
  });

  describe('fresh database (seeded height)', function () {
    it('should have explorer height above seeded value', async function () {
      const height = await db.explorerHeight();
      expect(height).to.be.greaterThan(2100000);
    });

    it('should report explorer as synced', async function () {
      const res = await node.isExplorerSynced();
      expect(res.status).to.equal('success');
      expect(res.data).to.equal(true);
    });

    it('should have explorer height within 2 blocks of daemon', async function () {
      const state = await daemon.getState();
      const explorerHeight = await db.explorerHeight();
      expect(state.currentHeight - explorerHeight).to.be.lessThanOrEqual(2);
    });

    it('should populate zelappshashes collection', async function () {
      const hashes = await db.hashCounts();
      expect(hashes.total).to.be.greaterThan(0);
    });

    it('should resolve hashes to permanent messages', async function () {
      const hashes = await db.hashCounts();
      expect(hashes.resolved).to.be.greaterThan(0);
    });
  });

  describe('cross-node explorer consistency', function () {
    before(async function () {
      await waitForApi(node2);
      await waitForExplorerSynced(node2, 180000);
    });

    it('should have similar explorer height on node 1 and node 2', async function () {
      const h1 = await db.explorerHeight();
      const h2 = await db2.explorerHeight();
      expect(Math.abs(h1 - h2)).to.be.lessThanOrEqual(3);
    });

    it('should have same hash count on node 1 and node 2', async function () {
      const c1 = await db.hashCounts();
      const c2 = await db2.hashCounts();
      expect(c1.total).to.equal(c2.total);
    });
  });
});
