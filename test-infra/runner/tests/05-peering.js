import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForDaemonReady, waitForPeers } from '../framework/wait.js';

let env;

describe('Peering', function () {
  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({ nodes: 5, tickerAutostart: false });
    await Promise.all(env.clients.map((c) => waitForDaemonReady(c)));
    await env.startDiscovery();
    await Promise.all(env.clients.map((c) => waitForPeers(c, { outbound: 1 })));
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

    it('should have outgoing peers on node 0', async function () {
      const events = env.clients[0].getEventBuffer().filter((e) => e.event === 'peers:added' && e.data.direction === 'outbound');
      expect(events.length).to.be.greaterThan(0);
    });

    it('should have peers from deterministic list', async function () {
      const validIps = new Set(env.clients.map((c) => c.ip));
      const peerEvents = env.clients[0].getEventBuffer().filter((e) => e.event === 'peers:added');
      for (const event of peerEvents) {
        expect(validIps.has(event.data.ip), `peer ${event.data.ip} not in node list`).to.be.true;
      }
    });
  });

  describe('network-wide peer health', function () {
    it('should have peers on all nodes', async function () {
      for (const client of env.clients) {
        const lastPeerEvent = client.getEventBuffer().filter((e) => e.event === 'peers:added').pop();
        expect(lastPeerEvent, `node ${client.ip} has no peer events`).to.not.be.undefined;
        expect(lastPeerEvent.data.total, `node ${client.ip} has 0 total peers`).to.be.greaterThan(0);
      }
    });

    it('should not have any node peered with itself', async function () {
      for (const client of env.clients) {
        const peerEvents = client.getEventBuffer().filter((e) => e.event === 'peers:added');
        const selfPeer = peerEvents.find((e) => e.data.ip === client.ip);
        expect(selfPeer, `node ${client.ip} peered with itself`).to.be.undefined;
      }
    });
  });
});
