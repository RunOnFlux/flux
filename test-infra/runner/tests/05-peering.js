import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForDaemonReady } from '../framework/wait.js';

let env;

describe('Peering', function () {
  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    for (const client of env.clients) {
      await client.waitForEvent('peers:added', (d) => d.outbound >= 1, 120000);
    }
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('discovery', function () {
    it('should wait for daemon sync before discovering', async function () {
      expect(env.nodeHasLog(0, 'Daemon Sync status')).to.equal(true);
    });

    it('should find own IP in deterministic node list', async function () {
      expect(env.nodeHasLog(0, 'My node was found on index')).to.equal(true);
    });

    it('should have outgoing peers', async function () {
      const res = await env.clients[0].getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });

    it('should have peers from deterministic list', async function () {
      const res = await env.clients[0].getPeers();
      const validIps = env.clients.map((c) => c.ip);
      for (const peer of res.data) {
        const peerIp = peer.split(':')[0];
        expect(validIps).to.include(peerIp);
      }
    });
  });

  describe('network-wide peer health', function () {
    it('should have peers on all nodes', async function () {
      for (const client of env.clients) {
        const res = await client.getPeers();
        expect(res.data.length, `node ${client.ip} has no peers`).to.be.greaterThan(0);
      }
    });

    it('should not have any node peered with itself', async function () {
      for (const client of env.clients) {
        const res = await client.getPeers();
        const selfPeer = res.data.find((p) => p.split(':')[0] === client.ip);
        expect(selfPeer, `node ${client.ip} peered with itself`).to.be.undefined;
      }
    });
  });
});
