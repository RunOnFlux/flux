import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus, removeFromNodeList, restoreToNodeList, resetNodeList, enableRpcFailure, disableRpcFailure } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForDaemonPolled, waitForNodeStatus } from '../framework/wait.js';

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
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('normal operation', function () {
    it('should read blockchain height via direct RPC', async function () {
      const rpc = await directRpc('getblockchaininfo');
      expect(rpc.error).to.be.null;
      expect(rpc.result.blocks).to.be.greaterThan(0);
    });

    it('should report daemon height via event', async function () {
      const event = env.clients[0].getEventBuffer().find((e) => e.event === 'daemon:polled');
      expect(event).to.not.be.undefined;
      expect(event.data.height).to.be.greaterThan(0);
    });

    it('should report confirmed status on first monitor cycle', async function () {
      this.timeout(30000);
      const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 20000);
      expect(event.data.confirmed).to.equal(true);
    });

    it('should read benchmark specs via direct RPC', async function () {
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
      const event = env.clients[0].getEventBuffer().find((e) => e.event === 'daemon:polled');
      expect(event.data.headers).to.equal(event.data.height);
    });
  });

  describe('per-node status override', function () {
    afterEach(async function () {
      await clearNodeStatus('198.18.1.0');
    });

    it('should detect EXPIRED via monitor after override set', async function () {
      this.timeout(30000);
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
      expect(event.data.confirmed).to.equal(false);
    });

    it('should detect CONFIRMED via monitor after override cleared', async function () {
      this.timeout(30000);
      await setNodeStatus('198.18.1.0', 'EXPIRED');
      await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
      await clearNodeStatus('198.18.1.0');
      const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 20000);
      expect(event.data.confirmed).to.equal(true);
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

    it('should stop receiving daemon:polled events when RPC fails', async function () {
      this.timeout(20000);
      await enableRpcFailure('198.18.1.0');
      const beforeCount = env.clients[0].getEventBuffer().filter((e) => e.event === 'daemon:polled').length;
      await new Promise((r) => setTimeout(r, 8000));
      const afterCount = env.clients[0].getEventBuffer().filter((e) => e.event === 'daemon:polled').length;
      expect(afterCount).to.equal(beforeCount);
    });

    it('should resume daemon:polled events when RPC recovers', async function () {
      this.timeout(20000);
      await enableRpcFailure('198.18.1.0');
      await new Promise((r) => setTimeout(r, 6000));
      await disableRpcFailure('198.18.1.0');
      const event = await waitForDaemonPolled(env.clients[0], () => true, 10000);
      expect(event.data.height).to.be.greaterThan(0);
    });
  });
});
