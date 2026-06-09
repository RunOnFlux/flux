import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus, removeFromNodeList, restoreToNodeList, resetNodeList, enableRpcFailure, disableRpcFailure } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForDaemonPolled, waitForNodeStatus, waitForDaemonUnreachable, waitForDaemonRecovered } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

let env;
const NODE_COUNT = 4;

async function directRpc(method, params = []) {
  const res = await fetch(`http://${subnet.daemon}:16124/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: 1 }),
  });
  return res.json();
}

async function directBenchRpc(method, params = []) {
  const res = await fetch(`http://${subnet.daemon}:16224/`, {
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
      await clearNodeStatus(subnet.nodeIp(1));
    });

    it('should detect EXPIRED via monitor after override set', async function () {
      this.timeout(30000);
      await setNodeStatus(subnet.nodeIp(1), 'EXPIRED');
      const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
      expect(event.data.confirmed).to.equal(false);
    });

    it('should detect CONFIRMED via monitor after override cleared', async function () {
      this.timeout(30000);
      await setNodeStatus(subnet.nodeIp(1), 'EXPIRED');
      await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
      await clearNodeStatus(subnet.nodeIp(1));
      const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 20000);
      expect(event.data.confirmed).to.equal(true);
    });
  });

  describe('deterministic list manipulation', function () {
    afterEach(async function () {
      await resetNodeList();
    });

    it('should reflect node removal from list', async function () {
      await removeFromNodeList(subnet.nodeIp(3));
      const rpc = await directRpc('viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.not.include(subnet.nodeIp(3));
      expect(rpc.result).to.have.length(NODE_COUNT - 1);
    });

    it('should reflect node restoration to list', async function () {
      await removeFromNodeList(subnet.nodeIp(3));
      await restoreToNodeList(subnet.nodeIp(3));
      const rpc = await directRpc('viewdeterministiczelnodelist');
      const ips = rpc.result.map((n) => n.ip);
      expect(ips).to.include(subnet.nodeIp(3));
      expect(rpc.result).to.have.length(NODE_COUNT);
    });
  });

  describe('RPC failure simulation', function () {
    afterEach(async function () {
      await disableRpcFailure(subnet.nodeIp(1));
    });

    it('should emit daemon:unreachable when RPC fails', async function () {
      this.timeout(20000);
      await enableRpcFailure(subnet.nodeIp(1));
      await waitForDaemonUnreachable(env.clients[0], 15000);
    });

    it('should emit daemon:recovered when RPC resumes', async function () {
      this.timeout(20000);
      await enableRpcFailure(subnet.nodeIp(1));
      await waitForDaemonUnreachable(env.clients[0], 15000);
      await disableRpcFailure(subnet.nodeIp(1));
      const event = await waitForDaemonRecovered(env.clients[0], 10000);
      expect(event.data).to.exist;
    });
  });
});
