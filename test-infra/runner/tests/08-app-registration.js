import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient, allNodes } from '../framework/node-client.js';
import { dbClient } from '../framework/db-client.js';
import { nodeKey, appOwnerKey, userKey } from '../framework/keys.js';
import { authenticate, signBtcMessage } from '../auth.js';
import { buildAppSpec, signAppSpec, registerApp, registerAndConfirm, checkPermanentSpec } from '../framework/app-helper.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForExplorerSynced, waitFor } from '../framework/wait.js';

const node = nodeClient(1);
const nodes = allNodes();
const db = dbClient(1);

describe('App registration', function () {
  before(async function () {
    this.timeout(300000);
    await daemon.resetAll();
    await daemon.startTicker();
    await waitForApi(node);
    await waitForExplorerSynced(node, 180000);
  });

  describe('submit registration', function () {
    it('should accept valid registration from app owner', async function () {
      this.timeout(30000);
      const spec = buildAppSpec({ name: `e2eValid${Date.now()}` });
      const result = await registerApp(node.url, nodeKey(1), spec);
      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data.length).to.equal(64);
    });

    it('should reject registration with missing signature', async function () {
      this.timeout(30000);
      const auth = await authenticate(node.url, nodeKey(1));
      const spec = buildAppSpec({ name: `e2eNoSig${Date.now()}` });

      const res = await fetch(`${node.url}/apps/appregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', zelidauth: auth.zelidauth },
        body: JSON.stringify({
          type: 'fluxappregister',
          version: 1,
          appSpecification: spec,
          timestamp: Date.now(),
          signature: '',
        }),
      });
      const data = await res.json();
      expect(data.status).to.equal('error');
    });

    it('should return 64-char hex hash on success', async function () {
      this.timeout(30000);
      const spec = buildAppSpec({ name: `e2eHash${Date.now()}` });
      const result = await registerApp(node.url, nodeKey(1), spec);
      expect(result.data).to.match(/^[a-f0-9]{64}$/);
    });
  });

  describe('temp message propagation', function () {
    let appHash;
    const appName = `e2eProp${Date.now()}`;

    before(async function () {
      this.timeout(60000);
      const spec = buildAppSpec({ name: appName });
      const result = await registerApp(node.url, nodeKey(1), spec);
      expect(result.status).to.equal('success');
      appHash = result.data;
      await new Promise((r) => setTimeout(r, 15000));
    });

    it('should store temp message on receiving node', async function () {
      const res = await node.getTempMessages(appHash);
      expect(res.status).to.equal('success');
      expect(res.data.length).to.be.greaterThan(0);
    });

    it('should propagate temp message to all 16 nodes', async function () {
      let count = 0;
      for (const n of nodes) {
        try {
          const res = await n.getTempMessages(appHash);
          if (res.status === 'success' && res.data?.length > 0) count++;
        } catch { /* node might be slow */ }
      }
      expect(count).to.equal(16);
    });
  });

  describe('blockchain confirmation', function () {
    let appHash;
    const appName = `e2eConfirm${Date.now()}`;

    before(async function () {
      this.timeout(180000);
      const spec = buildAppSpec({ name: appName });
      const result = await registerAndConfirm(node.url, nodeKey(1), spec, nodes);
      expect(result.status).to.equal('success');
      appHash = result.appHash;
      // Wait for hash sync to resolve the new hash
      await new Promise((r) => setTimeout(r, 30000));
    });

    it('should add hash to zelappshashes after block processed', async function () {
      const hashes = await db.hashCounts();
      expect(hashes.total).to.be.greaterThan(0);
    });

    it('should promote to permanent message after confirmation', async function () {
      await waitFor(async () => {
        const count = await db.permanentMessageCount();
        return count > 0;
      }, { timeout: 60000, label: 'permanent message count > 0' });
      const count = await db.permanentMessageCount();
      expect(count).to.be.greaterThan(0);
    });

    it('should populate app spec in zelappsinformation', async function () {
      await waitFor(async () => {
        const spec = await checkPermanentSpec(nodes.slice(0, 1), appName);
        return spec.count > 0;
      }, { timeout: 60000, label: `app spec ${appName} exists` });
      const spec = await checkPermanentSpec(nodes.slice(0, 1), appName);
      expect(spec.count).to.be.greaterThan(0);
    });
  });
});
