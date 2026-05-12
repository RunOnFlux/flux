import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerApp, registerAndConfirm, checkPermanentSpec } from '../framework/app-helper.js';
import { waitForApi, waitForExplorerSynced, waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';

let env;

describe('App registration', function () {
  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({ nodes: 4, tickerAutostart: true });
    for (const client of env.clients) {
      await waitForApi(client);
    }
    await waitForExplorerSynced(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('submit registration', function () {
    it('should accept valid registration from app owner', async function () {
      this.timeout(30000);
      const spec = buildAppSpec({ name: `e2eValid${Date.now()}` });
      const result = await registerApp(env.clients[0].url, nodeKey(1), spec);
      expect(result.status).to.equal('success');
      expect(result.data).to.be.a('string');
      expect(result.data.length).to.equal(64);
    });

    it('should reject registration with missing signature', async function () {
      const auth = await authenticate(env.clients[0].url, nodeKey(1));
      const spec = buildAppSpec({ name: `e2eNoSig${Date.now()}` });

      const res = await fetch(`${env.clients[0].url}/apps/appregister`, {
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
      const result = await registerApp(env.clients[0].url, nodeKey(1), spec);
      expect(result.data).to.match(/^[a-f0-9]{64}$/);
    });
  });

  describe('temp message propagation', function () {
    let appHash;

    before(async function () {
      this.timeout(60000);
      const spec = buildAppSpec({ name: `e2eProp${Date.now()}` });
      const result = await registerApp(env.clients[0].url, nodeKey(1), spec);
      expect(result.status).to.equal('success');
      appHash = result.data;
      await new Promise((r) => setTimeout(r, 15000));
    });

    it('should store temp message on receiving node', async function () {
      const res = await env.clients[0].getTempMessages(appHash);
      expect(res.status).to.equal('success');
      expect(res.data.length).to.be.greaterThan(0);
    });

    it('should propagate temp message to all nodes', async function () {
      let count = 0;
      for (const client of env.clients) {
        try {
          const res = await client.getTempMessages(appHash);
          if (res.status === 'success' && res.data?.length > 0) count++;
        } catch { /* */ }
      }
      expect(count).to.equal(env.clients.length);
    });
  });

  describe('blockchain confirmation', function () {
    let appHash;
    const appName = `e2eConfirm${Date.now()}`;

    before(async function () {
      this.timeout(120000);
      const spec = buildAppSpec({ name: appName });
      const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
      expect(result.status).to.equal('success');
      appHash = result.appHash;
      await new Promise((r) => setTimeout(r, 30000));
    });

    it('should add hash to zelappshashes after block processed', async function () {
      const db = dbClient(1);
      const hashes = await db.hashCounts();
      expect(hashes.total).to.be.greaterThan(0);
    });

    it('should promote to permanent message after confirmation', async function () {
      const db = dbClient(1);
      await waitFor(async () => {
        const count = await db.permanentMessageCount();
        return count > 0;
      }, { timeout: 50000, label: 'permanent message count > 0' });
      const count = await db.permanentMessageCount();
      expect(count).to.be.greaterThan(0);
    });

    it('should populate app spec in zelappsinformation', async function () {
      await waitFor(async () => {
        const spec = await checkPermanentSpec(env.clients.slice(0, 1), appName);
        return spec.count > 0;
      }, { timeout: 50000, label: `app spec ${appName} exists` });
      const spec = await checkPermanentSpec(env.clients.slice(0, 1), appName);
      expect(spec.count).to.be.greaterThan(0);
    });
  });
});
