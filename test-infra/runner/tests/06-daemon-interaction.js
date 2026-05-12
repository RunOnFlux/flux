import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus, removeFromNodeList, restoreToNodeList, resetNodeList, enableRpcFailure, disableRpcFailure } from '../framework/daemon-control.js';
import { waitForApi } from '../framework/wait.js';

let env;

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
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForApi(env.clients[0]);
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

    it('should read node status as CONFIRMED', async function () {
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.status).to.equal('CONFIRMED');
    });

    it('should read correct IP for this node', async function () {
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.ip).to.equal('198.18.1.0');
    });

    it('should read correct pubkey for this node', async function () {
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.pubkey).to.be.a('string');
      expect(rpc.result.pubkey.length).to.be.greaterThan(0);
    });

    it('should read correct collateral for this node', async function () {
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.collateral).to.include('COutPoint');
      expect(rpc.result.txhash).to.be.a('string');
      expect(rpc.result.txhash.length).to.equal(64);
    });

    it('should read benchmark specs matching node tier', async function () {
      const rpc = await directBenchRpc('getbenchmarks');
      expect(rpc.result.cores).to.be.greaterThan(0);
      expect(rpc.result.ram).to.be.greaterThan(0);
      expect(rpc.result.ssd).to.be.greaterThan(0);
    });

    it('should see all 16 nodes in deterministic list', async function () {
      const rpc = await directRpc('viewdeterministiczelnodelist');
      expect(rpc.result).to.have.length(16);
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
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should return CONFIRMED when override is cleared', async function () {
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      await clearNodeStatus('198.18.1.0');
      const rpc = await directRpc('getzelnodestatus');
      expect(rpc.result.status).to.equal('CONFIRMED');
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
      expect(rpc.result).to.have.length(15);
    });

    it('should reflect node restoration to list', async function () {
      await removeFromNodeList('198.18.3.0');
      await restoreToNodeList('198.18.3.0');
      const rpc = await directRpc('viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.include('198.18.3.0');
      expect(rpc.result).to.have.length(16);
    });
  });

  describe('RPC failure simulation', function () {
    afterEach(async function () {
      await disableRpcFailure('198.18.1.0');
    });

    it('should return error when RPC failure enabled', async function () {
      await enableRpcFailure('198.18.1.0');
      const rpc = await directRpc('getblockchaininfo');
      expect(rpc.result).to.be.null;
      expect(rpc.error).to.not.be.null;
      expect(rpc.error.code).to.equal(-28);
    });

    it('should recover when RPC failure disabled', async function () {
      await enableRpcFailure('198.18.1.0');
      await disableRpcFailure('198.18.1.0');
      const rpc = await directRpc('getblockchaininfo');
      expect(rpc.error).to.be.null;
      expect(rpc.result.blocks).to.be.greaterThan(0);
    });
  });
});
