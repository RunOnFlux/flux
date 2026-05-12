import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient, allNodes } from '../framework/node-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForPeers, waitFor } from '../framework/wait.js';
import { hasLogLine } from '../framework/log-reader.js';

const node = nodeClient(1);
const nodes = allNodes();

describe('Peering', function () {
  before(async function () {
    this.timeout(300000);
    await daemon.clearAllNodeStatus();
    await daemon.startTicker();
    await waitForApi(node);
  });

  describe('discovery', function () {
    it('should wait for daemon sync before discovering', async function () {
      const found = await hasLogLine(1, 'Daemon Sync status');
      expect(found).to.equal(true);
    });

    it('should find own IP in deterministic node list', async function () {
      const found = await hasLogLine(1, 'My node was found on index');
      expect(found).to.equal(true);
    });

    it('should have outgoing peers', async function () {
      await waitForPeers(node, 1, 300000);
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });

    it('should have peers from deterministic list', async function () {
      const res = await node.getPeers();
      const peerIps = res.data;
      const nodeIps = nodes.map((n) => n.ip);
      for (const peer of peerIps) {
        const peerIp = peer.split(':')[0];
        expect(nodeIps).to.include(peerIp);
      }
    });
  });

  describe('network-wide peer health', function () {
    before(async function () {
      this.timeout(300000);
      // Wait for all nodes to have at least 1 peer
      for (const n of nodes.slice(0, 4)) {
        await waitForApi(n);
        await waitForPeers(n, 1, 300000);
      }
    });

    it('should have peers on all sampled nodes', async function () {
      for (const n of nodes.slice(0, 4)) {
        const res = await n.getPeers();
        expect(res.data.length, `node ${n.num} has no peers`).to.be.greaterThan(0);
      }
    });

    it('should not have any node peered with itself', async function () {
      for (const n of nodes.slice(0, 4)) {
        const res = await n.getPeers();
        const selfPeer = res.data.find((p) => p.split(':')[0] === n.ip);
        expect(selfPeer, `node ${n.num} peered with itself`).to.be.undefined;
      }
    });
  });
});
