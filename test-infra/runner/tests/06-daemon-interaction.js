import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus, removeFromNodeList, restoreToNodeList, resetNodeList, enableRpcFailure, disableRpcFailure } from '../framework/daemon-control.js';
import { waitForApi, waitForBoot, waitFor } from '../framework/wait.js';

let env;
const NODE_COUNT = 4;

async function directRpc(method, params = []) {
  const res = await fetch(`http://198.18.0.3:16124/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: 1 }),
  });
  return res.json();
}

async function directBenchRpc(method, params = []) {
  const res = await fetch(`http://198.18.0.3:16224/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: 1 }),
  });
  return res.json();
}

describe('Daemon interaction', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: NODE_COUNT, tickerAutostart: false });
    await waitForApi(env.clients[0]);
    await waitForBoot(env, 0);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('normal operation', function () {
    it('should read blockchain height', async function () {
      const rpc = await directRpc('getblockchaininfo');
      expect(rpc.error).to.be.null;
      expect(rpc.result.blocks).to.be.greaterThan(0);
    });

    it('should read node status as CONFIRMED via FluxOS', async function () {
      const res = await env.clients[0].getNodeStatus();
      expect(res.status).to.equal('success');
      expect(res.data.status).to.equal('CONFIRMED');
    });

    it('should read correct IP for this node via FluxOS', async function () {
      const res = await env.clients[0].getNodeStatus();
      expect(res.data.ip).to.equal('198.18.1.0');
    });

    it('should read correct pubkey for this node via FluxOS', async function () {
      const res = await env.clients[0].getNodeStatus();
      expect(res.data.pubkey).to.be.a('string');
      expect(res.data.pubkey.length).to.be.greaterThan(0);
    });

    it('should read correct collateral for this node via FluxOS', async function () {
      const res = await env.clients[0].getNodeStatus();
      expect(res.data.collateral).to.include('COutPoint');
      expect(res.data.txhash).to.be.a('string');
      expect(res.data.txhash.length).to.equal(64);
    });

    it('should read benchmark specs matching node tier', async function () {
      const rpc = await directBenchRpc('getbenchmarks');
      expect(rpc.result.cores).to.be.greaterThan(0);
      expect(rpc.result.ram).to.be.greaterThan(0);
      expect(rpc.result.ssd).to.be.greaterThan(0);
    });

    it('should have correct node count in deterministic list', async function () {
      const rpc = await directRpc('viewdeterministiczelnodelist');
      expect(rpc.result).to.have.length(NODE_COUNT);
    });

    it('should report headers matching blocks (fully synced)', async function () {
      const rpc = await directRpc('getblockchaininfo');
      expect(rpc.result.headers).to.equal(rpc.result.blocks);
    });
  });

  describe('per-node status override', function () {
    afterEach(async function () {
      await clearNodeStatus('198.18.1.0');
    });

    it('should return EXPIRED when override is set', async function () {
      this.timeout(10000);
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      await waitFor(async () => {
        const res = await env.clients[0].getNodeStatus();
        return res.data.status === 'EXPIRED';
      }, { timeout: 8000, label: 'status EXPIRED' });
    });

    it('should return CONFIRMED when override is cleared', async function () {
      this.timeout(10000);
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      await waitFor(async () => {
        const res = await env.clients[0].getNodeStatus();
        return res.data.status === 'EXPIRED';
      }, { timeout: 8000, label: 'status EXPIRED' });
      await clearNodeStatus('198.18.1.0');
      await waitFor(async () => {
        const res = await env.clients[0].getNodeStatus();
        return res.data.status === 'CONFIRMED';
      }, { timeout: 8000, label: 'status CONFIRMED' });
    });
  });

  describe('deterministic list manipulation', function () {
    afterEach(async function () {
      await resetNodeList();
    });

    it('should reflect node removal from list', async function () {
      await removeFromNodeList('198.18.3.0');
      const rpc = await directRpc('viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.not.include('198.18.3.0');
      expect(rpc.result).to.have.length(NODE_COUNT - 1);
    });

    it('should reflect node restoration to list', async function () {
      await removeFromNodeList('198.18.3.0');
      await restoreToNodeList('198.18.3.0');
      const rpc = await directRpc('viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.include('198.18.3.0');
      expect(rpc.result).to.have.length(NODE_COUNT);
    });
  });

  describe('RPC failure simulation', function () {
    afterEach(async function () {
      await disableRpcFailure('198.18.1.0');
    });

    it('should return error when RPC failure enabled', async function () {
      this.timeout(10000);
      await enableRpcFailure('198.18.1.0');
      await new Promise((r) => setTimeout(r, 2000));
      const res = await env.clients[0].getBlockchainInfo();
      expect(res.status).to.equal('error');
    });

    it('should recover when RPC failure disabled', async function () {
      this.timeout(10000);
      await enableRpcFailure('198.18.1.0');
      await new Promise((r) => setTimeout(r, 2000));
      await disableRpcFailure('198.18.1.0');
      await new Promise((r) => setTimeout(r, 2000));
      const res = await env.clients[0].getBlockchainInfo();
      expect(res.status).to.equal('success');
      expect(res.data.blocks).to.be.greaterThan(0);
    });
  });
});
