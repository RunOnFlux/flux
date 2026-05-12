import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { dbClient } from '../framework/db-client.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi, waitForPeers, waitFor } from '../framework/wait.js';
import { hasLogLine } from '../framework/log-reader.js';
import { restartContainer } from '../framework/container.js';

const node = nodeClient(1);
const db = dbClient(1);

describe('Boot: confirmation state', function () {
  describe('node confirmed at boot', function () {
    before(async function () {
      await daemon.clearNodeStatus(node.ip);
      await waitForApi(node);
    });

    it('should detect status CONFIRMED from daemon', async function () {
      const res = await node.getNodeStatus();
      expect(res.status).to.equal('success');
      expect(res.data.status).to.equal('CONFIRMED');
    });

    it('should report node as confirmed in monitorNodeStatus', async function () {
      const found = await hasLogLine(1, 'monitorNodeStatus - Node is Confirmed');
      expect(found).to.equal(true);
    });

    it('should proceed to peer discovery', async function () {
      const found = await hasLogLine(1, 'Flux Discovery started');
      expect(found).to.equal(true);
    });

    it('should connect peers', async function () {
      await waitForPeers(node, 1, 180000);
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });
  });

  describe('node not confirmed at boot', function () {
    before(async function () {
      this.timeout(300000);
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await db.dropAndReseed(node.ip, 2100000);
      await restartContainer(1);
      await waitForApi(node);
      // Wait for at least one discovery cycle (120s retry on failure)
      await new Promise((r) => setTimeout(r, 10000));
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should detect non-CONFIRMED status from daemon', async function () {
      // Direct RPC check bypasses FluxOS cache
      const { stdout } = await import('../framework/container.js').then((c) =>
        c.execInContainer(1, 'curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d \'{"method":"getzelnodestatus","params":[],"id":1}\''),
      );
      const rpc = JSON.parse(stdout);
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should not connect any peers', async function () {
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });

    it('should log discovery awaiting message', async function () {
      const found = await hasLogLine(1, 'Node not confirmed.*discovery is awaiting|discovery is awaiting');
      expect(found).to.equal(true);
    });
  });

  describe('transition: expired to confirmed', function () {
    before(async function () {
      this.timeout(300000);
      // Node should still be EXPIRED from previous suite
      // Clear the override to restore CONFIRMED
      await daemon.clearNodeStatus(node.ip);
      // Wait for discovery retry (120s) plus connection time
      await waitForPeers(node, 1, 300000);
    });

    it('should resume peer discovery', async function () {
      const res = await node.getPeers();
      expect(res.data.length).to.be.greaterThan(0);
    });
  });

  describe('transition: confirmed to expired while running', function () {
    before(async function () {
      this.timeout(300000);
      // Ensure we have peers first
      await waitForPeers(node, 1, 300000);
      // Now expire the node
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      // Wait for monitorNodeStatus cycle to detect (runs every 20 min in prod, 30s in test)
      await new Promise((r) => setTimeout(r, 60000));
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
      // Give discovery time to reconnect for subsequent tests
      await new Promise((r) => setTimeout(r, 10000));
    });

    it('should drop peers after confirmation loss', async function () {
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });
  });
});
