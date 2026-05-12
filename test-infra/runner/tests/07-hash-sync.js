import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForApi, waitForExplorerSynced } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';

let env;

describe('Hash sync', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 2, tickerAutostart: false });
    await waitForApi(env.clients[0]);
    await waitForApi(env.clients[1]);
    await waitForExplorerSynced(env.clients[0]);
    await waitForExplorerSynced(env.clients[1]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('hash collection state', function () {
    it('should have accessible hash collection', async function () {
      const db = dbClient(1);
      const hashes = await db.hashCounts();
      expect(hashes.total).to.be.a('number');
    });

    it('should have permanent message count match resolved hashes', async function () {
      const db = dbClient(1);
      const hashes = await db.hashCounts();
      const permCount = await db.permanentMessageCount();
      expect(permCount).to.equal(hashes.resolved);
    });
  });

  describe('cross-node consistency', function () {
    it('should have same total hash count on node 1 and node 2', async function () {
      const db1 = dbClient(1);
      const db2 = dbClient(2);
      const h1 = await db1.hashCounts();
      const h2 = await db2.hashCounts();
      expect(h1.total).to.equal(h2.total);
    });

    it('should have same permanent message count on node 1 and node 2', async function () {
      const db1 = dbClient(1);
      const db2 = dbClient(2);
      const p1 = await db1.permanentMessageCount();
      const p2 = await db2.permanentMessageCount();
      expect(p1).to.equal(p2);
    });
  });
});
