import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { dbClient, closeDb } from '../framework/db-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForExplorerSynced, waitFor } from '../framework/wait.js';

const node1 = nodeClient(1);
const node2 = nodeClient(2);
const db1 = dbClient(1);
const db2 = dbClient(2);

describe('Hash sync', function () {
  before(async function () {
    this.timeout(300000);
    await daemon.resetAll();
    await daemon.startTicker();
    await waitForApi(node1);
    await waitForApi(node2);
    await waitForExplorerSynced(node1, 180000);
    await waitForExplorerSynced(node2, 180000);
  });

  describe('initial bootstrap', function () {
    it('should populate hashes after bootstrap runs', async function () {
      const hashes = await db1.hashCounts();
      expect(hashes.total).to.be.greaterThan(0);
    });
  });

  describe('message resolution', function () {
    it('should have resolved count greater than 0', async function () {
      const hashes = await db1.hashCounts();
      expect(hashes.resolved).to.be.greaterThan(0);
    });

    it('should have permanent message count match resolved hashes', async function () {
      const hashes = await db1.hashCounts();
      const permCount = await db1.permanentMessageCount();
      expect(permCount).to.equal(hashes.resolved);
    });
  });

  describe('cross-node consistency', function () {
    it('should have same total hash count on node 1 and node 2', async function () {
      const h1 = await db1.hashCounts();
      const h2 = await db2.hashCounts();
      expect(h1.total).to.equal(h2.total);
    });

    it('should have same resolved count on node 1 and node 2', async function () {
      const h1 = await db1.hashCounts();
      const h2 = await db2.hashCounts();
      expect(h1.resolved).to.equal(h2.resolved);
    });

    it('should have same permanent message count on node 1 and node 2', async function () {
      const p1 = await db1.permanentMessageCount();
      const p2 = await db2.permanentMessageCount();
      expect(p1).to.equal(p2);
    });
  });
});
