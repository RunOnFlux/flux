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
      // Set EXPIRED before restarting so node boots into unconfirmed state
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      await restartContainer(1);
      await waitForApi(node);
      // Wait for discovery to attempt and fail (5s retry in test config)
      await new Promise((r) => setTimeout(r, 15000));
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should detect non-CONFIRMED status from daemon', async function () {
      const { execInContainer } = await import('../framework/container.js');
      const { stdout } = await execInContainer(1,
        'curl -s -X POST http://198.18.0.3:16124/ -H "Content-Type: application/json" -d \'{"method":"getzelnodestatus","params":[],"id":1}\'',
      );
      const rpc = JSON.parse(stdout);
      expect(rpc.result.status).to.equal('EXPIRED');
    });

    it('should not connect any peers', async function () {
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });

    it('should log discovery awaiting message', async function () {
      const found = await hasLogLine(1, 'discovery is awaiting');
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
      await daemon.clearNodeStatus(node.ip);
      await waitForPeers(node, 1, 300000);
      await daemon.setNodeStatus(node.ip, 'EXPIRED');
      // Wait for monitorNodeStatus to detect (10s interval in test config)
      // and fluxDiscovery to check and disconnect
      await waitFor(async () => {
        const res = await node.getPeers();
        return res.data.length === 0;
      }, { timeout: 120000, interval: 5000, label: 'peers dropped after EXPIRED' });
    });

    after(async function () {
      this.timeout(300000);
      await daemon.clearNodeStatus(node.ip);
    });

    it('should drop peers after confirmation loss', async function () {
      const res = await node.getPeers();
      expect(res.data).to.have.length(0);
    });
  });
});
