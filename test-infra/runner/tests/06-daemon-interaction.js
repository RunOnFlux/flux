import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi } from '../framework/wait.js';
import { execInContainer } from '../framework/container.js';

const node = nodeClient(1);

async function directRpc(nodeNum, method, params = []) {
  const { stdout } = await execInContainer(nodeNum,
    `curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d '${JSON.stringify({ method, params, id: 1 })}'`,
  );
  return JSON.parse(stdout);
}

async function directBenchRpc(nodeNum, method, params = []) {
  const { stdout } = await execInContainer(nodeNum,
    `curl -s -X POST http://198.18.0.3:16224/ -H "Content-Type: application/json" -d '${JSON.stringify({ method, params, id: 1 })}'`,
  );
  return JSON.parse(stdout);
}

describe('Daemon interaction', function () {
  before(async function () {
    this.timeout(300000);
    await daemon.resetAll();
    await daemon.startTicker();
    await waitForApi(node);
  });

  after(async function () {
    await daemon.resetAll();
  });

  describe('normal operation', function () {
    it('should read blockchain height', async function () {
      const rpc = await directRpc(1, 'getblockchaininfo');
      expect(rpc.error).to.be.null;
      expect(rpc.result.blocks).to.be.greaterThan(0);
    });

    it('should read node status as CONFIRMED', async function () {
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.status).to.equal('CONFIRMED');
    });

    it('should read correct IP for this node', async function () {
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.ip).to.equal('198.18.1.0');
    });

    it('should read correct pubkey for this node', async function () {
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.pubkey).to.be.a('string');
      expect(rpc.result.pubkey.length).to.be.greaterThan(0);
    });

    it('should read correct collateral for this node', async function () {
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.collateral).to.include('COutPoint');
      expect(rpc.result.txhash).to.be.a('string');
      expect(rpc.result.txhash.length).to.equal(64);
    });

    it('should read benchmark specs matching node tier', async function () {
      const rpc = await directBenchRpc(1, 'getbenchmarks');
      expect(rpc.result.cores).to.be.greaterThan(0);
      expect(rpc.result.ram).to.be.greaterThan(0);
      expect(rpc.result.ssd).to.be.greaterThan(0);
    });

    it('should see all 16 nodes in deterministic list', async function () {
      const rpc = await directRpc(1, 'viewdeterministiczelnodelist');
      expect(rpc.result).to.have.length(16);
    });

    it('should report headers matching blocks (fully synced)', async function () {
      const rpc = await directRpc(1, 'getblockchaininfo');
      expect(rpc.result.headers).to.equal(rpc.result.blocks);
    });
  });

  describe('per-node status override', function () {
    after(async function () {
      await daemon.clearNodeStatus('198.18.1.0');
    });

    it('should return EXPIRED when override is set', async function () {
      await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should return CONFIRMED when override is cleared', async function () {
      await daemon.clearNodeStatus('198.18.1.0');
      const rpc = await directRpc(1, 'getzelnodestatus');
      expect(rpc.result.status).to.equal('CONFIRMED');
    });

    it('should only affect the targeted node', async function () {
      await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
      const rpc2 = await directRpc(2, 'getzelnodestatus');
      expect(rpc2.result.status).to.equal('CONFIRMED');
    });
  });

  describe('deterministic list manipulation', function () {
    after(async function () {
      await daemon.resetNodeList();
    });

    it('should reflect node removal from list', async function () {
      await daemon.removeFromNodeList('198.18.3.0');
      const rpc = await directRpc(1, 'viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.not.include('198.18.3.0');
      expect(rpc.result).to.have.length(15);
    });

    it('should reflect node restoration to list', async function () {
      await daemon.restoreToNodeList('198.18.3.0');
      const rpc = await directRpc(1, 'viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.include('198.18.3.0');
      expect(rpc.result).to.have.length(16);
    });
  });

  describe('RPC failure simulation', function () {
    after(async function () {
      await daemon.disableRpcFailure('198.18.1.0');
    });

    it('should return error when RPC failure enabled', async function () {
      await daemon.enableRpcFailure('198.18.1.0');
      const rpc = await directRpc(1, 'getblockchaininfo');
      expect(rpc.result).to.be.null;
      expect(rpc.error).to.not.be.null;
      expect(rpc.error.code).to.equal(-28);
    });

    it('should recover when RPC failure disabled', async function () {
      await daemon.disableRpcFailure('198.18.1.0');
      const rpc = await directRpc(1, 'getblockchaininfo');
      expect(rpc.error).to.be.null;
      expect(rpc.result.blocks).to.be.greaterThan(0);
    });

    it('should only affect the targeted node', async function () {
      await daemon.enableRpcFailure('198.18.1.0');
      const rpc2 = await directRpc(2, 'getblockchaininfo');
      expect(rpc2.error).to.be.null;
      expect(rpc2.result.blocks).to.be.greaterThan(0);
    });
  });
});
